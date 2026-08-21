package service

import (
	"sync"
)

// LogRingBuffer 每个执行的内存环形日志缓冲区。
// 容量有限（默认每执行 1000 条），用于 SSE 断线重连时回放最近的日志，
// 避免每次重连都全量查询数据库。
type LogRingBuffer struct {
	mu      sync.RWMutex
	cap     int
	buffers map[int64][]map[string]interface{}
}

// NewLogRingBuffer 创建环形缓冲区，capPerExec 为每个执行保留的最大条数。
func NewLogRingBuffer(capPerExec int) *LogRingBuffer {
	if capPerExec <= 0 {
		capPerExec = 1000
	}
	return &LogRingBuffer{cap: capPerExec, buffers: make(map[int64][]map[string]interface{})}
}

// Append 追加一条日志到指定执行的缓冲区。
func (r *LogRingBuffer) Append(execID int64, entry map[string]interface{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	buf := append(r.buffers[execID], entry)
	if len(buf) > r.cap {
		buf = buf[len(buf)-r.cap:]
	}
	r.buffers[execID] = buf
}

// Recent 返回指定执行缓冲的日志副本（按追加顺序）。
func (r *LogRingBuffer) Recent(execID int64) []map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()
	buf := r.buffers[execID]
	out := make([]map[string]interface{}, len(buf))
	copy(out, buf)
	return out
}

// Remove 删除指定执行的缓冲区（执行清理时调用）。
func (r *LogRingBuffer) Remove(execID int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.buffers, execID)
}
