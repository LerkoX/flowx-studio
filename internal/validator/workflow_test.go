package validator

import (
	"strings"
	"testing"
)

func TestWorkflowValidator_NodeRefDoesNotNeedExecutorWhenExecutorsPresent(t *testing.T) {
	yamlConfig := `Name: mixed
Graph: |
  stateDiagram-v2
    [*] --> Inline
    Inline --> Referenced
    Referenced --> [*]
Nodes:
  Inline:
    executor: local-shell
    steps:
      - name: run
        run: echo hi
  Referenced:
    config:
      nodeRef: echo
      executor:
        type: local
Executors:
  local-shell:
    type: local
    config:
      shell: bash
`
	if err := NewWorkflowValidator().Validate(yamlConfig); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestWorkflowValidator_InlineNodeStillRequiresDefinedExecutor(t *testing.T) {
	yamlConfig := `Name: invalid
Graph: |
  stateDiagram-v2
    [*] --> Inline
    Inline --> [*]
Nodes:
  Inline:
    executor: missing
    steps:
      - name: run
        run: echo hi
Executors:
  local-shell:
    type: local
`
	err := NewWorkflowValidator().Validate(yamlConfig)
	if err == nil || !strings.Contains(err.Error(), "undefined executor") {
		t.Fatalf("Validate() error = %v, want undefined executor", err)
	}
}
