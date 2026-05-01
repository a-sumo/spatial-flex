# UI development on Spectacles: friction points and feature requests

UI dev on Spectacles remains one of the most time-consuming parts of the AR development workflow, and I suspect we're all hitting the same walls in parallel and coming up with bespoke solutions for our respective use cases.

I'd like to use this thread to surface those friction points collectively so we can hand the Spectacles team focused, granular feedback instead of scattered one-off asks.

To get the conversation started, the recurring gap I keep running into is the absence of a spatial equivalent of HTML and CSS, which is to say no declarative layout, no constraint solver, and limited runtime introspection. Coding agents help with the generation side of UI work, but generation alone doesn't get you to a coherent user flow, so the orchestration work still falls back on the developer.

Those challenges are what prompted me to start releasing small open-source pieces in this direction. The first drop is a text reflow utility: https://github.com/a-sumo/spatial-flex/tree/main/packages/text-reflow

To keep things actionable, a few suggested buckets to drop into:

1. Layout and constraints: what's hardest to express? (centering, fitting text in a box, responsive sizing, anchoring)
2. Runtime introspection: how are you inspecting instantiated UI today?
3. Live preview and testing: how do you verify the user experience matches your specification?
