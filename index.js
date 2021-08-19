/*jslint node: true*/
'use strict';

var responder = require('beamjs').responder;
var backend = require('beamjs').backend();
var behaviour = backend.behaviour({

  overwritePath: true,
  skipSameRoutes: true
});

module.exports = function (options) {

  if (!options) throw new Error('Invalid options');
  if (!Array.isArray(options)) options = [options];
  return options.reduce(function (behaviours, behaviour_options) {

    if (typeof behaviour_options !== 'object')
      throw new Error('Invalid options');
    if (typeof behaviour_options.name !== 'string' ||
      behaviour_options.name.length === 0)
      throw new Error('Invalid behaviour name');
    if (typeof behaviour_options.directory !== 'string' ||
      behaviour_options.directory.length === 0)
      throw new Error('Invalid resources directory');
    behaviours[behaviour_options.name] = behaviour({

      name: behaviour_options.name,
      version: behaviour_options.version || '1',
      path: behaviour_options.path || '/*',
      method: 'GET',
      type: 'integration',
      fetcher: behaviour_options.name,
      storage: 'local',
      queue: behaviour_options.queue || function (name, parameters) {

        return parameters.filePath || name;
      },
      parameters: {

        filePath: {

          key: 'url',
          type: 'middleware'
        }
      },
      returns: {

        stream: {

          type: 'body'
        },
        filename: {

          type: 'body'
        }
      },
      plugin: responder('stream')
    }, function (init) {

      return function () {

        var self = init.apply(this, arguments).self();
        var index = '/' + (behaviour_options.index || 'index.html');
        var error = null;
        var ignore = false;
        var stream = null;
        var components = null;
        var path = self.parameters.filePath;
        var folder = typeof path !== 'string' || path.length === 0;
        if (!folder) {

          components = path.split('/');
          folder = path.split('/').pop().split('.').length < 2;
        }
        if (folder) {

          var root = !components || components.length < 2 || components[1] == '';
          path = (!root ? components.join('/') : '') + index;
        }
        path = path.split('?')[0];
        self.begin('ErrorHandling', function (key, businessController, operation) {

          operation.error(function (e) {

            return ignore ? undefined : error || e;
          }).apply();
        });
        self.begin('Fetch', function (key, businessController, operation) {

          operation.resource({

            path: behaviour_options.directory + path
          }).stream(function () {

            return function (resource_stream) {

              stream = resource_stream;
            };
          }).callback(function (resource, e) {

            if (e) error = e;
          }).apply();
        }).use(function (key, businessController, next) {

          if (error && folder && path != index) self.run(behaviour_options.name, {

            url: index
          }, function (response, e) {

            ignore = !!response && !e;
            if (response) {

              stream = response.stream;
              path = index;
            }
            next();
          }); else next();
        }).begin(function (key, businessController, operation) {

          operation.callback(function (response) {

            response.stream = stream;
            response.filename = path.split('/').pop();
          }).apply();
        }).when('ModelObjectMapping');
      };
    });
    return behaviours;
  }, {});
};