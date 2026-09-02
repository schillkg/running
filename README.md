# Stridebook

Stridebook is a simple installable running-plan app for Android, iPhone, and a regular web browser. It works offline after the first visit. Workout logs are stored on the device using the app; there is no account, advertising, or tracking.

## What is included

- Today, weekly Plan, and Progress views
- Done, Adjusted, Skipped, and Planned workout logging
- Multiple goals without deleting prior plans or history
- A first-run choice between the bundled Fall Creek 50K plan and starting a personal goal
- Goal hiding and restoring
- Full JSON backup and restore
- Google Sheets-ready CSV export
- A backup reminder after several workout changes or a week with unbacked changes
- Run locations with Google Maps directions from the phone’s current location
- Customizable strength and accessory routines
- Offline use and phone installation

## The four kinds of data

### The phone copy

The copy stored by Stridebook on the current phone or browser is the working copy. Updating the app at the same web address does not erase it. Different phones have completely separate data.

Clearing Chrome’s site data, losing the phone, or deliberately deleting browser storage can remove the working copy. Download backups regularly.

### Full backup JSON

**Download backup** creates a complete restore file containing goals, plans, workout logs, routines, preferences, and locations. This is the file to save in Dropbox or Google Drive.

**Import plan/backup** can restore it on the same phone or move the data to another device. Restoring replaces the current device copy, so Stridebook downloads a safety copy first.

On Android, cloud providers sometimes label JSON files as an unknown file type. Stridebook does not restrict the file picker. If Dropbox still greys out a backup, download the file to the phone’s **Downloads** folder and select it through Android **Files**.

### Plan JSON

A plan file contains one goal and its dated workouts. Importing it adds or completes that goal without deleting other goals or workout history.

After import, the new plan looks like every other Stridebook plan:

- Today shows the next scheduled workout.
- Plan groups dated workout cards into weeks.
- Progress tracks that goal separately.
- Other goals remain selectable unless hidden.

### Google Sheets CSV

**Export Sheets CSV** creates a readable snapshot of all workouts for Google Sheets. It is not synchronization: logging a run in Stridebook does not update the Sheet, and editing the Sheet does not update Stridebook. The CSV is not a complete restore file.

## Starting another goal

1. Open **Plan → New goal**.
2. Enter the event, date, distance, available run days, and a short description of current training.
3. Choose **Create goal request**.
4. Download the request from the draft goal.
5. Attach that request in a Codex task and ask Codex to create the plan JSON.
6. In Stridebook, open **Progress → Import plan/backup** and select the plan Codex returns.

The draft is replaced by the dated plan. Existing goals and history stay intact.

## Strength and accessory routines

The app uses **Strength** as the general section name. A routine may contain lifting, mobility, balance, ankle stability, or any other accessory work that supports running.

The bundled Fall Creek plan includes Saturday lower-body strength and ankle-stability routines. They remain visible for that plan. Other runners can hide supplied routines, restore hidden routines, or add a custom routine with their own exercises and doses. A newly imported plan can also provide goal-specific strength routines.

## Another runner

Another person can install the same public site on their own phone. On first use they can choose **Start my own plan**, create a request, and import their own plan. Their data stays on their phone and does not mix with anyone else’s.

## Locations and privacy

Location cards open Google Maps directions with the trailhead as the destination. Google Maps supplies the starting location and live drive time. Stridebook does not request, read, or store the phone’s location.

The public repository contains the Fall Creek training plan, public trailhead addresses, and public source links. It does not contain a home address, neighborhood-based drive estimates, or completed workout history.

The original private starter backup remains outside this project folder:

`../outputs/fall-creek-50k-2026/My_Training_Private_Backup.json`

Do not upload that file to a public repository.

## Publishing and development

Follow [PUBLISH_AND_INSTALL.md](./PUBLISH_AND_INSTALL.md) for GitHub Pages and phone installation. No paid service or build step is required.

The code has no third-party runtime dependencies. With Node.js installed, run `node --test tests/*.test.mjs` from this folder.
