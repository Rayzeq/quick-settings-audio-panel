Quick Settings Audio Panel
==========================

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">](https://extensions.gnome.org/extension/5940/quick-settings-audio-panel/)

Quick Settings Audio Panel (QSAP) is a gnome 43/44 extension that creates a new panel for sound related stuff in the quick settings.

Features
--------

| Move master volume sliders (speaker / headphone and microphone) to the new panel | Always show the microphone volume slider, but the icon in the top don't change behavior ! | Move (or duplicate) media controls into this panel |
|:--:|:--:|:--:|
| <img src="images/master.png" width="300px" /> | <img src="images/input1.png" width="200px" /><img src="images/input2.png" width="200px" /> | <img src="images/master+media.png" width="300px" /> |
| Create an application mixer | You can also reorder everything the way you like | If you want to, you can even merge the new panel into the main one |
| <img src="images/master+media+mixer.png" width="300px" /> | <img src="images/reorder1.png" width="200px" /><img src="images/reorder2.png" width="200px" /> | <img src="images/merge.png" width="300px" /> |
| The panel can be (almost) wherever you want ! | It's more limited on merged panel though | |
| <img src="images/panel-left.png" width="300px" /><img src="images/panel-right.png" width="300px" /> | <img src="images/panel-top.png" width="200px" /><img src="images/panel-top-merged.png" width="200px" /> | |

Notice
------

The Bluetooth menu overflows the other quick settings below it. It's a known issue that is also present in the original panel, and I can't fix it.

Compatibility
-------------

As it's heavily inspired by it, this plugin is mostly incompatible with Quick Settings Tweaker (QST). However, as long as you don't enable features that try to do the same thing, it should work.

Known incompatibilities are:
  - Everything in the `Input/Output` tab of QST won't work if you enable `Move master volume sliders`. However, no crash should be observed.
  - The notification panel added by QST can't be separated from the quick settings menu.
  - `Remove Media Control on Date Menu` (but not `Remove Notifications On Date Menu`) will remove the media controls from the sound panel if you **move** the media controls using this extension. If you **duplicate** the media controls with the extension, they won't be affected.
  - In some situations, disabling QSAP can crash QST.

On Gnome Shell 43, compatibility with QST has not been tested.

Manual installation
-------------------

If you can't install the extension from ego for some reason, you can install it manually. This extension **CANNOT** be installed on gnome-shell 42 or older.

Instructions:
 * Download the [latest version](https://github.com/Rayzeq/quick-settings-audio-panel/releases)
 * Extract the zip archive you just downloaded in `~/.local/share/gnome-shell/extensions`
 * Rename the extracted folder to `quick-settings-audio-panel@rayzeq.github.io`
 * Restart gnome shell (the easiest way is to log out and log back in)
