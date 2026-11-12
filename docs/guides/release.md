# Release

A pushed tag `v<version>` runs `.github/workflows/release.yml`. It runs the CI checks, then `scripts/package-release.mjs`, then publishes a GitHub Release on `KOCEAN33/savetab`.

## Cut a release

1. Set `version` in `apps/extension/package.json`. The manifest version comes from this field. Use `<major>.<minor>.<patch>` digits only, since Chrome and Firefox reject other version strings.
2. Commit, then tag that commit `v<version>` and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow fails when the tag differs from the `package.json` version. Fix the version, move the tag, and push again.

To build the same assets locally, run `node scripts/package-release.mjs` from the repo root. The assets land in `apps/extension/.output/release/`. Without the AMO env variables it skips signing.

## Assets

| Asset | What it is |
| --- | --- |
| `savetab-<version>-chrome.zip` | The Chrome build. Its manifest `key` fixes the extension id at `mjkkpkbgjflhjgdkhhnejpjcdkfcpmkb` on every unpacked install, so sync sign-in works. |
| `savetab-<version>-firefox.xpi` | The Firefox build, signed by AMO on the unlisted channel. It carries `update_url`, so it updates itself. |
| `savetab-<version>-firefox.zip` | The unsigned Firefox build. It replaces the xpi when the AMO secrets are missing. |
| `savetab-<version>-sources.zip` | `git archive` of the tagged commit, with the lockfile. AMO receives it as the source upload. |
| `updates.json` | The Firefox update manifest. Its `update_link` points at this tag's xpi. |

A release without a signed xpi is a prerelease and has no `updates.json`. GitHub's `releases/latest` skips prereleases, so installed copies keep updating from the last signed release.

`update_url` is `https://github.com/KOCEAN33/savetab/releases/latest/download/updates.json`. `wxt.config.ts` adds it only when the build env has `SAVETAB_SELF_DISTRIBUTED=1`. A store build leaves the variable unset, so Firefox updates a listed add-on from AMO.

## Install

- Chrome: unzip the chrome zip, open `chrome://extensions`, turn on Developer mode, choose Load unpacked, and pick the unzipped folder. Chrome does not update an unpacked extension. Install each new release the same way, over the same folder, to keep its data.
- Firefox, signed: open the xpi asset link in Firefox and confirm the install prompt. Firefox checks `updates.json` and installs later signed releases itself.
- Firefox, unsigned: release Firefox refuses the zip as a permanent add-on. Load it from `about:debugging` > This Firefox > Load Temporary Add-on, which lasts until Firefox restarts. For a permanent install, use Firefox Developer Edition or Nightly with `xpinstall.signatures.required` set to `false` in `about:config`.

## 서명 자격증명 발급 (AMO)

Firefox xpi 서명에 쓰는 AMO API 자격증명을 발급해 repo secret으로 넣는 절차다. 한 번만 하면 된다.

1. https://addons.mozilla.org 에 Mozilla 계정으로 로그인한다. 계정이 없으면 만든다. 비용은 없다.
2. API 키 페이지를 연다: https://addons.mozilla.org/developers/addon/api/key/
3. 개발자 약관 동의 화면이 나오면 동의한다.
4. "Generate new credentials"를 누른다. 페이지에 값 두 개가 나온다.
   - JWT issuer: `user:12345:67` 형태의 문자열
   - JWT secret: 긴 16진수 문자열. 비밀번호와 같으므로 채팅, 커밋, 문서에 붙여 넣지 않는다.
5. 두 값을 GitHub repo secret으로 넣는다. 둘 중 한 방법을 쓴다.
   - 웹: `KOCEAN33/savetab` > Settings > Secrets and variables > Actions > New repository secret. 이름은 `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`.
   - 터미널: 아래 명령을 차례로 실행하고, 프롬프트가 뜨면 값을 붙여 넣는다.
     ```bash
     gh secret set AMO_JWT_ISSUER --repo KOCEAN33/savetab
     gh secret set AMO_JWT_SECRET --repo KOCEAN33/savetab
     ```
6. 확인: `gh secret list --repo KOCEAN33/savetab` 출력에 두 이름이 보인다.

secret을 넣은 뒤 처음 push하는 태그에서 AMO에 unlisted add-on `savetab@kocean33`이 만들어진다. unlisted 버전은 AMO가 자동으로 서명한다. 리뷰어가 나중에 소스 업로드와 대조해 볼 수 있다.

secret이 유출되면 같은 페이지에서 "Revoke and regenerate credentials"로 폐기하고 5번을 다시 한다.

## Rebuild from source

AMO reviewers rebuild from the sources zip:

1. Install Node.js and the pnpm version in the root `package.json` `packageManager` field.
2. Run `pnpm install --frozen-lockfile`.
3. Run `SAVETAB_SELF_DISTRIBUTED=1 pnpm --filter @savetab/extension build:firefox`.
4. Compare `apps/extension/.output/firefox-mv3` with the xpi contents.
