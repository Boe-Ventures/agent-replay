# Self-Hosted GitHub Actions Runner — zeus-mac

## Overview
Self-hosted runner registered at the **Boe-Ventures org level**, available to all repos in the org.

## Runner Details
- **Name:** zeus-mac
- **Labels:** `self-hosted`, `macOS`, `ARM64`
- **Scope:** Organization (Boe-Ventures)
- **Location:** ~/actions-runner
- **Work directory:** ~/actions-runner/_work
- **Runner version:** v2.334.0
- **Status:** Online ✅

## Host System
- macOS 26.3.1 (Apple Silicon)
- Node.js v25.8.0
- pnpm 10.30.3
- agent-browser 0.25.4 ✅
- maestro: NOT installed ❌

## Setup Steps (performed 2026-04-26)

1. Downloaded runner v2.334.0 for macOS ARM64:
   ```bash
   mkdir -p ~/actions-runner && cd ~/actions-runner
   curl -o actions-runner.tar.gz -L "https://github.com/actions/runner/releases/download/v2.334.0/actions-runner-osx-arm64-2.334.0.tar.gz"
   tar xzf actions-runner.tar.gz
   ```

2. Registered at org level:
   ```bash
   TOKEN=$(gh api orgs/Boe-Ventures/actions/runners/registration-token -X POST --jq '.token')
   ./config.sh --url https://github.com/Boe-Ventures --token "$TOKEN" --name "zeus-mac" --labels "self-hosted,macOS,ARM64" --work _work --unattended --replace
   ```

3. Started the runner:
   ```bash
   cd ~/actions-runner && nohup ./run.sh > runner.log 2>&1 &
   ```

4. Installed RunnerBar (menu bar monitor):
   ```bash
   curl -fsSL https://eonist.github.io/runner-bar/install.sh | bash
   ```

## Start / Stop

### Start
```bash
cd ~/actions-runner && nohup ./run.sh > runner.log 2>&1 &
```

### Stop
```bash
cd ~/actions-runner && ./config.sh remove  # unregister
# or just kill the process:
pkill -f "Runner.Listener"
```

### Install as launchd service (auto-start on boot)
```bash
cd ~/actions-runner
sudo ./svc.sh install
sudo ./svc.sh start
# Check status: sudo ./svc.sh status
# Stop: sudo ./svc.sh stop
# Uninstall: sudo ./svc.sh uninstall
```

## Using in Workflows
```yaml
jobs:
  test:
    runs-on: [self-hosted, macOS, ARM64]
    steps:
      - uses: actions/checkout@v4
      - run: echo "Running on zeus-mac"
```

A test workflow template is at `~/test-self-hosted-workflow.yml` (not pushed to any repo).

## Verify Runner Status
```bash
gh api orgs/Boe-Ventures/actions/runners --jq '.runners[] | {name, status, labels: [.labels[].name]}'
```

## RunnerBar
- Installed to /Applications/RunnerBar.app
- Menu bar app that shows runner status
- Configure it to monitor Boe-Ventures/homi (or org-wide)

## Known Issues / Notes
- Runner is running as user process (not launchd service) — will stop on logout/reboot
- To persist across reboots, install as service with `./svc.sh install`
- maestro is not installed — needed for iOS simulator tests
- Runner PATH may differ from interactive shell — tools installed via bun/brew may need PATH additions in workflows
- The runner tarball (~120MB) is kept at ~/actions-runner/actions-runner.tar.gz — safe to delete after setup

## Security Notes
- Runner is org-scoped — any repo in Boe-Ventures can target it
- Runs as kristianeboe user with full filesystem access
- Be cautious with public repos — restrict runner to private repos only via GitHub Settings > Actions > Runner groups
