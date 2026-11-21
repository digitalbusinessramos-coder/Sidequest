# Replacing the stock photos with your own

The app uses a few photos from Wikimedia Commons (beach, old town, cathedral…). The project team can swap any of them for its own pictures without touching the code.

1. Find the photo's key in `shared/photos.js` (for example `canteras`). Its file is `public/photos/<key>.jpg`.
2. Save your photo as a JPEG with the same file name, about 1200 px wide and under 300 KB, and replace the old file.
3. In `shared/photos.js`, update that entry: `alt` (what the photo shows), `author` (who took it), `license` (for your own photo, for example "Used with permission" or "CC BY 4.0"), `license_url` and `source` (can be left empty for your own photo).
4. Commit and merge to `main`. Railway redeploys and the City Guide's "Photo credits" list shows the new credit automatically.

Only use photos you took yourself or have permission to use, and don't show people's faces without their consent.
