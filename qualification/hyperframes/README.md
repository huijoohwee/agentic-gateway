# Two timed cards

Open index.html with HyperFrames 0.9.85. The root declares a one-second 64 × 64 composition. The first card is red through the first half-second and the second is blue through the end. Both occupy track 0. Run the upstream CLI locally with telemetry disabled.

```sh
hyperframes lint . --json
hyperframes timeline . --json
hyperframes snapshot . --at 0.1 --no-end --output first
hyperframes snapshot . --at 0.75 --no-end --output second
```

Paste the same full document into a Graph HTML video node and run the node. The composition declares the source dimensions and duration. The node supplies the export frame rate.
