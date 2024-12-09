Contextual information display for Signal K
===========================================

This is an adaptation of the [c-base infoscreens system](https://github.com/c-base/infoscreens) for Signal K. The idea is to enable HTML-capable viewers (like a kiosk display) to show different dashboards depending on whether the boat is sailing, at anchor, etc. This works well for instance with an onboard [Grafana](https://grafana.com/) installation.

<img width="886" alt="Screenshot 2024-12-09 at 13 37 06" src="https://github.com/user-attachments/assets/bbcfa2ea-19c5-47a0-a90d-e38122fca3d4">

## Usage

Install this plugin and the [signalk-autostate plugin](https://github.com/meri-imperiumi/signalk-autostate#readme).

Configure the plugin and set URLs for the different navigation states:
<img width="735" alt="Screenshot 2024-12-09 at 13 38 00" src="https://github.com/user-attachments/assets/b61fe6d4-e47b-49bb-8a2e-5aeea649b769">

Point your kiosk browser to the webapp URL supplied by this plugin (`/@meri-imperiumi/signalk-infodisplay/` on your Signal K server.
