package service

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/event"
)

// 节点媒体产物 marker（路线 A：媒体通道统一化）。
//
// kind 与 Studio 完全解耦：kind 是不透明分类标签（节点生态自描述，如 frame/result/
// 或任何自定义值）；Studio 只解释 mode（replace=覆盖式最新产物 / append=追加序列产物），
// 以及 source（http=物化拉取落盘 / local=本地登记）。新增 kind 无需改 Studio。

// mediaMarkerPrefixes 节点 stdout 的媒体标记前缀。FLOWX_PREVIEW 是旧名
// （语义等价 FLOWX_MEDIA{kind:"frame", mode:"replace", source:{type:http,url,token}}）。
var mediaMarkerPrefixes = []string{"FLOWX_MEDIA ", "FLOWX_PREVIEW "}

// mediaMarkerPayload 统一 marker 载荷（兼容新旧两种标记）。
type mediaMarkerPayload struct {
	Kind     string        `json:"kind"`
	Mode     string        `json:"mode"` // replace|append（空按 kind 推导：frame→replace，其它→append）
	Name     string        `json:"name"`
	MIME     string        `json:"mime"`
	Progress *float64      `json:"progress"`
	Base     string        `json:"base"`
	JobID    string        `json:"job_id"`
	Source   *markerSource `json:"source"`
	// 旧 FLOWX_PREVIEW 扁平字段（url/token 顶层，无 source 包装）
	URL   string `json:"url"`
	Token string `json:"token"`
}

type markerSource struct {
	Type  string `json:"type"` // http|local（空且 url 非空视为 http）
	URL   string `json:"url"`
	Token string `json:"token"`
	Path  string `json:"path"`
}

// 归一化后的视图（供注册表/物化/广播使用）。
type mediaMarkerView struct {
	kind, mode, name, mime string
	progress               *float64
	base, jobID            string
	srcURL, srcToken       string // http 来源
	srcPath                string // local 来源
	legacy                 bool   // 来自旧 FLOWX_PREVIEW
}

func parseMediaMarker(raw string) (mediaMarkerView, error) {
	var p mediaMarkerPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return mediaMarkerView{}, err
	}
	v := mediaMarkerView{
		kind: strings.TrimSpace(p.Kind), mode: strings.TrimSpace(p.Mode),
		name: strings.TrimSpace(p.Name), mime: strings.TrimSpace(p.MIME),
		progress: p.Progress, base: strings.TrimRight(strings.TrimSpace(p.Base), "/"),
		jobID: strings.TrimSpace(p.JobID),
	}
	if p.Source != nil {
		v.srcURL = strings.TrimSpace(p.Source.URL)
		v.srcToken = strings.TrimSpace(p.Source.Token)
		v.srcPath = strings.TrimSpace(p.Source.Path)
		if strings.EqualFold(p.Source.Type, "local") {
			v.srcURL, v.srcToken = "", "" // local 不应携带 http 来源
		}
	}
	// 旧扁平字段兜底（source 缺省或为空）
	if v.srcURL == "" && v.srcPath == "" {
		v.srcURL = strings.TrimSpace(p.URL)
		v.srcToken = strings.TrimSpace(p.Token)
		v.legacy = true
	}
	if v.kind == "" {
		v.kind = "frame" // 旧标记只有"过程帧"语义
	}
	if v.mode == "" {
		if v.kind == "frame" {
			v.mode = "replace"
		} else {
			v.mode = "append"
		}
	}
	return v, nil
}

// handleMediaMarker 处理节点 stdout 的媒体标记行：
//  1. 更新来源注册表（previewSrcs：中断兜底 / 节点级代理的 base·token 解析仍读这里）；
//  2. 物化到磁盘（http 来源异步拉取落盘；local 来源登记）；
//  3. 广播轻量 node_preview 事件（先 progress-only 尽快刷新进度，物化完成后再带 path）。
func (s *WorkflowService) handleMediaMarker(execID int64, nodeID string, v mediaMarkerView) {
	// 1) 来源注册表（语义不变：url/token/base/jobID/progress；媒体本体不进这里）
	key := fmt.Sprintf("%d/%s", execID, nodeID)
	now := time.Now()
	s.previewMu.Lock()
	src := s.previewSrcs[key]
	if src == nil {
		src = &previewSource{}
		s.previewSrcs[key] = src
	}
	src.url = v.srcURL
	src.token = v.srcToken
	src.updatedAt = now
	if v.base != "" {
		src.base = v.base
	}
	if v.jobID != "" {
		src.jobID = v.jobID
	}
	if v.progress != nil {
		src.progress = *v.progress
	}
	// 顺带清扫过期来源（执行结束后不会再有新标记）
	for k, it := range s.previewSrcs {
		if now.Sub(it.updatedAt) > previewSourceTTL {
			delete(s.previewSrcs, k)
		}
	}
	progress := src.progress
	jobID := src.jobID
	s.previewMu.Unlock()

	// 2) 物化
	var materializedPath string
	if s.mediaCache != nil {
		if v.srcPath != "" {
			if p, err := s.mediaCache.RegisterLocal(execID, nodeID, v.kind, v.mode, v.name,
				MediaSource{Path: v.srcPath, Base: v.base, JobID: v.jobID}); err == nil {
				materializedPath = p
			}
		} else if v.srcURL != "" {
			// 异步拉取；完成后广播带 path 的事件（前端据 media 清单/preview url 拿到文件）
			go func() {
				p, err := s.mediaCache.Materialize(execID, nodeID, v.kind, v.mode, v.name,
					MediaSource{URL: v.srcURL, Token: v.srcToken, Base: v.base, JobID: v.jobID})
				if err != nil || p == "" {
					return
				}
				s.publishNodeMedia(execID, nodeID, v.kind, progress, jobID, p)
			}()
		}
	}

	// 3) 进度事件（物化路径就绪前先刷进度；local 来源同步完成，直接带 path）
	s.publishNodeMedia(execID, nodeID, v.kind, progress, jobID, materializedPath)
}

// publishNodeMedia 广播 node_preview 事件（轻量：不带媒体本体；path 指媒体出口可用的磁盘路径）。
func (s *WorkflowService) publishNodeMedia(execID int64, nodeID, kind string, progress float64, jobID, path string) {
	s.eventBus.Publish(event.Event{Type: "node_preview", Data: map[string]interface{}{
		"execution_id": execID,
		"node_id":      nodeID,
		"kind":         kind,
		"progress":     progress,
		"job_id":       jobID, // 节点上报的不透明任务标识（语义由节点生态自定），透传给 widget
		"path":         path,  // 物化后的磁盘路径；空=尚无产物（仅进度）
		"timestamp":    time.Now(),
	}})
}

// splitMediaMarkers 按行拆分日志文本：FLOWX_MEDIA / FLOWX_PREVIEW 标记行的
// JSON 负载收进 markers（同时记录前缀以便兼容解析），其余行原样用 \n 重 join。
// 无标记时 rest 为原文、markers 为空；结尾换行保留原文习惯（有标记时才重写）。
func splitMediaMarkers(text string) (rest string, markers []string) {
	trailingNL := strings.HasSuffix(text, "\n")
	var kept []string
	for _, line := range strings.Split(strings.TrimSuffix(text, "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		matched := false
		for _, prefix := range mediaMarkerPrefixes {
			if strings.HasPrefix(trimmed, prefix) {
				markers = append(markers, strings.TrimPrefix(trimmed, prefix))
				matched = true
				break
			}
		}
		if !matched {
			kept = append(kept, line)
		}
	}
	if len(markers) == 0 {
		return text, nil
	}
	rest = strings.Join(kept, "\n")
	if trailingNL && rest != "" {
		rest += "\n"
	}
	return rest, markers
}
