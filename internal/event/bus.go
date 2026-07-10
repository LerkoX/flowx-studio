package event

import "sync"

// Event 通用事件
type Event struct {
	Type string
	Data interface{}
}

// Bus 内存事件总线
type Bus struct {
	mu          sync.RWMutex
	subscribers map[chan Event]struct{}
}

// NewBus 创建事件总线
func NewBus() *Bus {
	return &Bus{
		subscribers: make(map[chan Event]struct{}),
	}
}

// Subscribe 订阅事件，返回取消订阅函数
func (b *Bus) Subscribe() (chan Event, func()) {
	ch := make(chan Event, 64)
	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()

	unsubscribe := func() {
		b.mu.Lock()
		delete(b.subscribers, ch)
		b.mu.Unlock()
		close(ch)
	}

	return ch, unsubscribe
}

// Unsubscribe 取消订阅
func (b *Bus) Unsubscribe(ch chan Event) {
	b.mu.Lock()
	delete(b.subscribers, ch)
	b.mu.Unlock()
	close(ch)
}

// Publish 发布事件
func (b *Bus) Publish(e Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	for ch := range b.subscribers {
		select {
		case ch <- e:
		default:
			// channel 满，丢弃
		}
	}
}

// SubscriberCount 返回订阅者数量
func (b *Bus) SubscriberCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.subscribers)
}
