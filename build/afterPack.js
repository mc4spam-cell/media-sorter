'use strict';

// electron-builder afterPack hook (macOS only).
//
// The prebuilt Electron app ships Info.plist keys Media Sorter never uses:
// camera / microphone / Bluetooth usage strings, and an App Transport
// Security block that allows arbitrary loads. The app makes no network
// requests and touches none of those devices, so strip the usage strings and
// tighten ATS to NSAllowsArbitraryLoads = false. PlistBuddy is part of macOS,
// and this only runs when packaging the macOS target.

const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const plist = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Info.plist');

  const run = (cmd) => {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'ignore' });
    } catch {
      // Key may be absent in some Electron versions — ignore.
    }
  };

  run('Delete :NSCameraUsageDescription');
  run('Delete :NSMicrophoneUsageDescription');
  run('Delete :NSBluetoothAlwaysUsageDescription');
  // Replace the whole ATS dict with a single, strict entry.
  run('Delete :NSAppTransportSecurity');
  run('Add :NSAppTransportSecurity dict');
  run('Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool false');
};
