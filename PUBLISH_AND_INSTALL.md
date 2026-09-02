# Publish and install My Training

You only need to use GitHub on your computer for publishing. You do not need to sign in to GitHub on your Android phone.

## Part 1 — Publish from your computer

1. Open [github.com](https://github.com/) on your computer and sign in as `schillkg`.
2. Open [github.com/new](https://github.com/new).
3. Set the owner to `schillkg` and repository name to `running`.
4. Choose **Public**. This keeps GitHub Pages free. Only the app code, training plan, and public trailhead information will be public. Your workout logs and neighborhood-based drive estimates are in the separate private backup.
5. Choose **Create repository**. Do not add a README or template because this folder already contains those files.
6. On the empty repository page, choose **uploading an existing file**. If files already exist there, use **Add file → Upload files** instead.
7. Open the `run-training-app` folder on your computer, select its contents, and drag them onto the upload page. Confirm that `index.html` will appear at the top level—not inside another `run-training-app` folder. Do not upload `My_Training_Private_Backup.json`; it is outside this folder on purpose.
8. Enter a message such as `Publish My Training` and choose **Commit changes**.
9. Open **Settings → Pages** in the repository.
10. Under **Build and deployment**, choose **Deploy from a branch**.
11. Choose branch **main**, folder **/(root)**, then choose **Save**.
12. Wait a few minutes. GitHub will show the address in the Pages settings. It should be:

   `https://schillkg.github.io/running/`

You need to be signed in to GitHub only while creating, uploading, or updating the repository. Never send anyone your GitHub password, two-factor code, recovery code, personal access token, or private SSH key.

## Part 2 — Install on Android

1. Open the actual **Chrome** app on your Android phone.
2. Visit `https://schillkg.github.io/running/`.
3. Let it finish loading once.
4. Tap Chrome's three-dot menu.
5. Choose **Install app** or **Add to Home screen**.
6. Confirm. My Training will appear with your other apps.

No GitHub login, APK file, Google Play account, or developer fee is needed on the phone.

## Part 3 — Restore the two workouts already logged

1. In the installed app, open **Progress**.
2. Choose **Import plan/backup**.
3. Select `My_Training_Private_Backup.json` from Dropbox or your phone's Files app. It is located in:

   `Workout/running/outputs/fall-creek-50k-2026/`

4. Confirm the restore. The app first downloads a safety copy, then restores the two completed workouts.

After that, workout entries remain on that phone. Use **Download backup** periodically. Use **Export Sheets CSV** whenever you want a fresh, readable copy in Google Sheets.

## Official help pages

- [Create a GitHub repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
- [Upload files to GitHub](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [Configure GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Install a web app on Android](https://web.dev/learn/pwa/installation)
