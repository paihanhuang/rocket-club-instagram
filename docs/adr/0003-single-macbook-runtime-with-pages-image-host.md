---
status: accepted
---
# Everything runs on one MacBook; approved images are served from GitHub Pages

All scheduled work (worker, publisher, chief) runs on the president's MacBook under launchd, because the local model lives there and the budget is zero. Posts publish when the Mac is awake, which can mean evening instead of afternoon; that was accepted over a cloud publisher because a cloud publisher needs a second copy of the Instagram secrets and one more moving part to hand off. Instagram's API fetches images from a public URL, so approved images are pushed to a GitHub Pages branch, and removed again once Instagram has fetched them, so club photos never sit on a public mirror longer than needed. The archive is the local state directory and Instagram itself.
