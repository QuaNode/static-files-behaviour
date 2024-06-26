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
  return options.reduce(function () {

    var [behaviours, behaviour_options] = arguments;
    if (typeof behaviour_options !== 'object') {

      throw new Error('Invalid options');
    }
    var {
      name: behaviour_name,
      version,
      host,
      path: behaviour_path,
      queue,
      storage,
      directory,
      index: default_index,
      error: mapError
    } = behaviour_options;
    var named = typeof behaviour_name === 'string';
    if (named) {

      named &= behaviour_name.length > 0;
    }
    if (!named) {

      throw new Error('Invalid behaviour name');
    }
    var location = typeof directory === 'string';
    if (location) {

      location &= directory.length > 0;
    }
    if (!location) {

      throw new Error('Invalid resources directory');
    }
    if (typeof mapError !== 'function') {

      mapError = undefined;
    }
    behaviours[behaviour_name] = behaviour({

      name: behaviour_name,
      version: version || '1',
      path: behaviour_path || '/*',
      host: host,
      method: 'GET',
      type: 'integration',
      fetcher: behaviour_name,
      storage: storage || 'local',
      timeout: 50,
      queue: queue || function (name, parameters) {

        let { path, filePath } = parameters;
        if ([
          '.html', '.js', '.css', '.woff',
          '.woff2', '.ttf', '.eot', '.svg',
          '.jpg', '.png', '.gif'
        ].some(function (ext) {

          return path.toLowerCase().endsWith(ext);
        })) return;
        return filePath || name;
      },
      parameters: {

        filePath: {

          key: 'url',
          type: 'middleware'
        },
        ranges: {

          key: 'range',
          type: 'header'
        }
      },
      returns: {

        stream: {

          type: 'body'
        },
        stats: {

          type: 'body'
        },
        filename: {

          type: 'body'
        },
        cache: {

          type: 'body'
        }
      },
      plugin: responder('stream', {

        immutable: true,
        maxAge: '1y',
        cacheControl: true,
        acceptRanges: true,
        lastModified: true,
        etag: true
      })
    }, function (init) {

      return function () {

        var self = init.apply(this, arguments).self();
        let {
          filePath: path,
          ranges
        } = self.parameters;
        var index = '/' + (default_index || 'index.html');
        var error = null;
        var ignore = false;
        var stream = null;
        var stats = null;
        var components = null;
        var folder = typeof path !== 'string';
        if (!folder) folder != path.length === 0;
        if (!folder) {

          components = path.split('/');
          var component_index = components.findIndex(...[
            function (component) {

              return component.indexOf('?') > -1;
            }
          ]);
          var last = components.splice(component_index).shift();
          if (!last) last = components.pop();
          last = last.split('?')[0];
          components.push(last);
          folder = last.split('.').length < 2;
        }
        if (folder) {

          var root = !components || components.length < 2;
          if (!root) root |= components[1] == '';
          path = !root ? components.join('/') : '';
          path += index;
        }
        path = self.parameters.path = path.split('?')[0];
        self.begin(...[
          'ErrorHandling', function (_, __, operation) {

            operation.error(...[
              !ignore && mapError ? mapError : function (e) {

                return ignore ? undefined : error || e;
              }
            ]).apply();
          }
        ]).begin('Fetch', function (_, __, operation) {

          operation.resource({

            path: directory + path,
            ranges
          }).stream(function () {

            return function (resource_stream) {

              stream = resource_stream;
            };
          }).callback(function (resource, e) {

            if (e) error = e;
            if (resource) stats = resource.stats;
          }).apply();
        }).use(function (_, __, next) {

          if (error && folder && path != index) {

            self.run(behaviour_name, {

              filePath: index
            }, function (response, e) {

              ignore = !!response && !e;
              if (response) {

                stream = response.stream;
                path = index;
              }
              next();
            });
          } else next();
        }).begin(function (_, __, operation) {

          operation.callback(function (response) {

            response.stream = stream;
            response.stats = stats;
            var filename = path.split('/').pop();
            response.filename = filename;
            filename = filename.toLowerCase();
            response.cache = !filename.endsWith('.html');
          }).apply();
        }).when('ModelObjectMapping');
      };
    });
    return behaviours;
  }, {});
};