package handler

import (
	"encoding/json"
	"net/http"

	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/gin-gonic/gin"
)

// EventHandler SSE 事件处理器
type EventHandler struct {
	bus *event.Bus
}

// NewEventHandler 创建事件处理器
func NewEventHandler(bus *event.Bus) *EventHandler {
	return &EventHandler{bus: bus}
}

// RegisterRoutes 注册路由
func (h *EventHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/events", h.StreamEvents)
}

// StreamEvents SSE 实时事件流
func (h *EventHandler) StreamEvents(c *gin.Context) {
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Error(c, http.StatusInternalServerError, "streaming not supported")
		return
	}

	ch, unsubscribe := h.bus.Subscribe()
	defer unsubscribe()

	for {
		select {
		case evt := <-ch:
			payload, _ := json.Marshal(evt)
			c.Writer.Write([]byte("event: "))
			c.Writer.Write([]byte(evt.Type))
			c.Writer.Write([]byte("\ndata: "))
			c.Writer.Write(payload)
			c.Writer.Write([]byte("\n\n"))
			flusher.Flush()

		case <-c.Request.Context().Done():
			return
		}
	}
}
