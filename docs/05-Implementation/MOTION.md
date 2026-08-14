# VSMS motion

Motion explains a state change; it never decorates a clinical workspace.

| Token | Duration | Use |
| --- | ---: | --- |
| instant | 80ms | pressed feedback, status acknowledgement |
| fast | 140ms | navigation indicator, inline validation |
| standard | 200ms | drawer, inspector and theme changes |
| slow | 280ms | queue insertion, transfer and reordering |

Use an ease-out-quint or equivalent. Animate opacity, transform and bounded colour changes; do not animate layout dimensions, use bouncy motion, parallax, background loops or permanent urgent pulses. Queue reordering may use layout motion only when it reveals why order changed.

`prefers-reduced-motion: reduce` removes nonessential movement while retaining an instant state change. No interaction or status may depend on animation completing.
