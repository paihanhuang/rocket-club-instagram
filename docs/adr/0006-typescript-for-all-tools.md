---
status: accepted
---
# All tools are TypeScript on Node

Tools are written in TypeScript with pnpm, Vitest, and Playwright. Python was the alternative and is slightly nicer for scraping; TypeScript was chosen because Node is the runtime both agent harnesses already need, the rendering path is first-class, and the test-first skills the project follows assume it. One language keeps the handoff to a successor to one toolchain.
