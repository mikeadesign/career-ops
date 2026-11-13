package screens

import "strings"

// wordWrap greedily wraps text to width columns and returns the lines.
// Fork-only helper for the Tasks screen (wordWrapTaskField in tasks.go);
// kept in its own file so `update-system.mjs` does not drop it. Words longer
// than width are hard-split so no returned line exceeds width.
func wordWrap(text string, width int) []string {
	if width < 1 {
		width = 1
	}
	var lines []string
	var cur []rune
	flush := func() {
		if len(cur) > 0 {
			lines = append(lines, string(cur))
			cur = cur[:0]
		}
	}
	for _, word := range strings.Fields(text) {
		w := []rune(word)
		for len(w) > width {
			flush()
			lines = append(lines, string(w[:width]))
			w = w[width:]
		}
		if len(cur) == 0 {
			cur = append(cur, w...)
		} else if len(cur)+1+len(w) <= width {
			cur = append(cur, ' ')
			cur = append(cur, w...)
		} else {
			flush()
			cur = append(cur, w...)
		}
	}
	flush()
	return lines
}
