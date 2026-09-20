# Instagram Publishing — Sourced Facts

Research date: 2026-09-19. Every bullet cites the page it was read from. Anything not confirmed against a primary doc is listed at the end.

## 1. Login / product path for publishing to your own Business account

- Two setups exist: "Instagram API with Instagram Login" and "Instagram API with Facebook Login for Business" (https://developers.facebook.com/docs/instagram-platform)
- Instagram Login supports "Instagram Business" and "Instagram Creator" accounts; Facebook Login supports "Instagram Business and Instagram Creator accounts that are linked to a Facebook Page" (https://developers.facebook.com/docs/instagram-platform)
- Instagram Login: "This API setup does not require a Facebook Page to be linked to the Instagram professional account." (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)
- Both paths support content publishing; Facebook Login additionally offers hashtag search and metadata about other professional accounts (https://developers.facebook.com/docs/instagram-platform)
- Instagram Login scopes listed: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_messages`, `instagram_business_manage_comments` (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)

## 2. Content publishing rules — feed images and carousels

- "JPEG is the only image format supported. Extended JPEG formats such as MPO and JPS are not supported. Shopping tags are not supported. Filters are not supported." — PNG is not accepted (https://developers.facebook.com/docs/instagram-platform/content-publishing)
- Image specifications: "Format: JPEG", "File size: 8 MB maximum", "Aspect ratio: Must be within a 4:5 to 1.91:1 range", "Minimum width: 320 (will be scaled up to the minimum if necessary)", "Maximum width: 1440 (will be scaled down to the maximum if necessary)", "Color Space: sRGB. Images using other color spaces will have their color spaces converted to sRGB." (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)
- `image_url`: "We will cURL the image using the URL that you specify so the image must be on a public server." (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)
- Media "must be hosted on a publicly accessible server at the time of the publishing attempt" (https://developers.facebook.com/docs/instagram-platform/content-publishing)
- "Carousels are limited to 10 images, videos, or a mix of the two." (https://developers.facebook.com/docs/instagram-platform/content-publishing)
- `children` is "an array of up to 10 container IDs of each image and video that should appear in the published carousel"; "Reels cannot appear in carousels"; per-child captions are "Not supported on images or videos in carousels" (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)
- Carousel aspect ratio is a cropping behaviour, not a stated requirement: "Carousel images are all cropped based on the first image in the carousel, with the default being a 1:1 aspect ratio." (https://developers.facebook.com/docs/instagram-platform/content-publishing)
- Instagram Login publishing permissions: `instagram_business_basic` + `instagram_business_content_publish` (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing)

## 3. Publishing rate limit and quota check

- "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period. Carousels count as a single post." (https://developers.facebook.com/docs/instagram-platform/content-publishing)
- Check usage with `GET /<IG_ID>/content_publishing_limit` (https://developers.facebook.com/docs/instagram-platform/content-publishing)
- Reference page returns `quota_usage` (containers published since a given time), `config.quota_total` (documented there as 50) and `config.quota_duration` (86400 seconds); optional `since` param must be no older than 24 hours (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/)
- Required permissions for that endpoint on the Instagram Login path: `instagram_business_basic`, `instagram_business_content_publish` (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/)
- Note: the guide says 100 posts / 24h while the reference page's `quota_total` example/description says 50 — the two Meta pages disagree (https://developers.facebook.com/docs/instagram-platform/content-publishing ; https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/)

## 4. Access tokens on the Instagram Login path

- "Access tokens from the business login flow are short-lived and valid for 1 hour." Tokens generated in the App Dashboard "are long-lived and are valid for 60 days." (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started)
- Long-lived tokens are valid for 60 days and can be refreshed for another 60 days (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
- Exchange: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=<secret>&access_token=<short-lived-token>` (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
- Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<long-lived-token>` (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
- Refresh conditions: "The existing long-lived access token is at least 24 hours old", the token is valid (not expired), and the user has granted `instagram_business_basic` (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
- Development mode: "Apps in Development mode can only request permissions from role users, and only permissions with standard or advanced access levels"; move to Live mode only "after you have completed app development and have completed App Review" (https://developers.facebook.com/docs/development/build-and-test/app-modes)
- App Review scenario table: for "My app is only for a business I own or manage" at Standard Access, App Review is "Not required" (https://developers.facebook.com/docs/instagram-platform/app-review)
- Insights scope on this path is `instagram_business_manage_insights` alongside `instagram_business_basic` (https://developers.facebook.com/docs/instagram-platform/insights)

## 5. Insights available on the Instagram Login path

- Account-level metrics: `accounts_engaged`, `comments`, `engaged_audience_demographics`, `follows_and_unfollows`, `follower_demographics`, `likes`, `profile_links_taps`, `reach`, `replies`, `reposts`, `saves`, `shares`, `total_interactions`, `views`; `impressions` deprecated (https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)
- Follower thresholds: `follower_count` and `online_followers` "are not available on Instagram business or creator accounts with fewer than 100 followers"; `follows_and_unfollows` and `follower_demographics` are "Not returned if the IG User has less than 100 followers"; `engaged_audience_demographics` is not returned below 100 engagements (https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)
- Media-level metrics for FEED posts (image/carousel): `comments`, `likes`, `reach`, `saved`, `shares`, `total_interactions`, `views`, `follows`, `profile_visits`, `profile_activity`, `reposts` (https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/)
- Media insights permissions on this path: `instagram_business_basic` + `instagram_business_manage_insights` (https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/)
- "Some metrics are not available on Instagram accounts with fewer than 100 followers."; `total_comments`, `total_likes`, `total_views` are "only available for Instagram API with Facebook Login"; Story insights are Facebook-Login-only (https://developers.facebook.com/docs/instagram-platform/insights)
- Meta's launch post states `instagram_business_manage_insights` requires Advanced Access (https://developers.facebook.com/blog/post/2025/03/24/user-and-media-insights-on-instagram-api-with-instagram-login/)

## 6. Launch Library 2 API

- "all the API data is available at no cost for up to 15 requests per hour"; higher rates via Patreon (https://thespacedevs.com/llapi)
- Current base URL: `https://ll.thespacedevs.com/2.3.0/` (https://thespacedevs.com/llapi)
- Upcoming launches endpoint: `https://ll.thespacedevs.com/2.3.0/launches/upcoming/` (also `launches/` and `launches/previous/`) (https://ll.thespacedevs.com/2.3.0/)

## 7. GitHub Pages

- "It can take up to 10 minutes for changes to your site to publish after you push the changes to GitHub." (https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- "Published GitHub Pages sites may be no larger than 1 GB."; soft limits of 100 GB bandwidth/month and 10 builds/hour, the latter not applying to custom GitHub Actions workflows (https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## 8. Discord attachment CDN URLs

- Attachments uploaded to Discord's CDN have signed URLs with a preset expiry; three query parameters are added: `ex` ("Hex timestamp indicating when an attachment CDN URL will expire"), `is` (hex timestamp when the URL was issued), `hm` (unique signature valid until expiration) (https://docs.discord.com/developers/reference)
- Discord refreshes attachment CDN URLs inside its own client; a signed URL received in an API payload is valid at that time (https://docs.discord.com/developers/reference)
- CDN URLs passed into API fields (embed `url`, webhook `avatar_url`) can be sent without parameters and "Discord will automatically render and refresh the URL"; the standard CDN endpoints are not signed and do not expire (https://docs.discord.com/developers/reference)

## Unverified or unclear

- The exact expiry window for signed Discord attachment URLs (widely reported as 24 hours) is not stated in Discord's developer reference. [unverified]
- Whether carousel children are *required* to share an aspect ratio: Meta documents only that children are cropped to the first image, not a validation rule. [unverified]
- The 100 vs 50 posts-per-24h discrepancy between Meta's content publishing guide and the `content_publishing_limit` reference is unresolved in the docs.
- Whether `instagram_business_manage_insights` can be used at Standard Access on your own account in Development mode: the App Review page says review is "Not required" for a business you own, while the 2025 launch blog post says the permission requires Advanced Access. [unverified]
- Per-request Graph API rate limits (calls/hour) for the Instagram Login path were not read from a primary page in this pass. [unverified]
- Exact Launch Library 2 rate limits for authenticated/Patreon tiers. [unverified]
