package model

// Task represents a follow-up task row from data/tasks.md.
// Fork-only file: upstream removed the Tasks feature in v1.33.0, so this
// lives apart from career.go to survive `update-system.mjs`.
type Task struct {
	Number    int
	Created   string
	Due       string
	AppNumber int // 0 if unattached
	Company   string
	Type      string // followup | contact | interview | manual
	Title     string
	Status    string // pending | done | skipped
	Completed string
	Notes     string
}
