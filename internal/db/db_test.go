package db

import (
	"path/filepath"
	"testing"
)

func TestNewEnablesWAL(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := New(dbPath)
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	var mode string
	if err := database.Get(&mode, "PRAGMA journal_mode"); err != nil {
		t.Fatalf("failed to query journal_mode: %v", err)
	}

	if mode != "wal" && mode != "WAL" {
		t.Fatalf("expected WAL mode, got %q", mode)
	}
}

func TestNewInMemoryDoesNotFail(t *testing.T) {
	// in-memory 数据库不需要也不支持 WAL，应正常打开
	database, err := New(":memory:")
	if err != nil {
		t.Fatalf("failed to open in-memory database: %v", err)
	}
	defer database.Close()

	var one int
	if err := database.Get(&one, "SELECT 1"); err != nil {
		t.Fatalf("failed to query in-memory database: %v", err)
	}
	if one != 1 {
		t.Fatalf("expected 1, got %d", one)
	}
}
