# Evergreen Setnik App B-Roll

Drop 3–5 short, vertical (9:16) screen recordings of the Setnik app into this folder to enable **App B-Roll + Dynamic Hook Overlays** in the short-form video renderer (`tools/tiktok_growth/render_growth_video.py`).

## Suggested Clips (record once, reused every week)
- `swipe_deck.mp4` — 5–8s scrolling/swiping through upcoming shows in the Setnik deck
- `audio_preview.mp4` — 5–8s tapping a show card and playing a 30-second band preview
- `filter_metro.mp4` — 4–6s switching genre or city filters
- `save_show.mp4` — 4–6s bookmarking/saving a show

## Notes
- Supported extensions: `.mp4`, `.mov`
- Keep each clip under ~10 MB so the repository stays fast.
- If this folder has no video clips yet, `render_growth_video.py` automatically falls back to **100% Playwright motion-graphic cards**, so the pipeline works out of the box without any B-roll.
