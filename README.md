# My Training

My Training is a small installable running-plan app designed for a phone. It works offline after the first visit and stores workout logs in the browser's private device storage.

## Included in version 0.1.0

- The Fall Creek 50K plan from August 31 through November 22, 2026
- Today, Plan, Progress, Locations, Routines, and New Goal views
- Workout logging with Done, Adjusted, Skipped, and Planned statuses
- Device-local IndexedDB storage
- Complete JSON backup and restore
- Safe plan-package import for future goals
- A Google Sheets-ready workout CSV export
- Ten nearby running and hiking locations
- Offline caching and Android installation support

## Privacy

The repository contains the training plan, public trailhead addresses, and public source links. It does not contain the user's exact home address, neighborhood-based drive estimates, or completed workout history.

The private starter backup is intentionally stored outside this project folder:

`../outputs/fall-creek-50k-2026/My_Training_Private_Backup.json`

Do not upload that backup to a public GitHub repository.

## Publish and install

Follow [PUBLISH_AND_INSTALL.md](./PUBLISH_AND_INSTALL.md). No build command or paid service is required.

## Future goals and Google Sheets

**New Goal** saves a new race or goal without replacing prior plans or logs. It then downloads a small plan-request file for Codex; import the plan file Codex returns. Plan generation is intentionally not automatic inside the app, which keeps version 1 free, private, and free of accounts or API keys.

**Export Sheets CSV** creates a current copy of all workouts for Google Sheets. Version 1 does not live-sync to a Sheet; that can be added later if the manual export becomes inconvenient.

## Development check

The code has no third-party runtime dependencies. With Node.js installed, run `node --test tests/*.test.mjs` from this folder.
