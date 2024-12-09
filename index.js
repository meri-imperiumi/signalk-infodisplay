module.exports = (app) => {
  const plugin = {
    id: 'signalk-infodisplay',
    name: 'Contextual information display for Signal K',
    start: (settings) => {
      const stateUrls = {};
      if (settings && settings.defaultUrl) {
        stateUrls.default = settings.defaultUrl;
      }
      if (settings && settings.stateUrls) {
        settings.stateUrls.forEach((u) => {
          stateUrls[u.state] = u.url;
        });
      }
      // Register API endpoint for public-readable URL config
      app.get('/signalk/v2/api/infodisplay', (req, res) => {
        res.status(200);
        res.json(stateUrls);
      });
    },
    stop: () => {
    },
    schema: {
      type: 'object',
      properties: {
        defaultUrl: {
          title: 'Default URL',
          type: 'string',
          format: 'uri',
        },
        stateUrls: {
          type: 'array',
          default: [],
          title: 'URLs for vessel navigation states',
          items: {
            type: 'object',
            properties: {
              state: {
                title: 'State',
                type: 'string',
                default: 'sailing',
                enum: [
                  // See https://github.com/SignalK/specification/blob/master/schemas/groups/navigation.json
                  'not under command',
                  'anchored',
                  'moored',
                  'sailing',
                  'motoring',
                  'towing < 200m',
                  'towing > 200m',
                  'pushing',
                  'fishing',
                  'fishing-hampered',
                  'trawling',
                  'trawling-shooting',
                  'trawling-hauling',
                  'pilotage',
                  'not-under-way',
                  'aground',
                  'restricted manouverability',
                  'restricted manouverability towing < 200m',
                  'restricted manouverability towing > 200m',
                  'restricted manouverability underwater operations',
                  'constrained by draft',
                  'mine clearance',
                ],
              },
              url: {
                title: 'URL',
                type: 'string',
                format: 'uri',
              },
            },
          },
        },
      },
    },
  };

  return plugin;
};
