import makeDebug from 'debug';
import { stripSlashes } from 'feathers-commons';
import Uberproto from 'uberproto';
import mixins from './mixins/index';

const debug = makeDebug('feathers:application');
const methods = ['find', 'get', 'create', 'update', 'patch', 'remove'];
const Proto = Uberproto.extend({
  create: null
});

const hasMethod = (object, methods) => methods.some(name =>
  (object && typeof object[name] === 'function')
);

const isSubApp = object => object && object._app;

// If it contains one of the methods it's a service
const isService = object => hasMethod(object, methods.concat('setup'));

export default {
  init() {
    Object.assign(this, {
      methods,
      mixins: mixins(),
      services: {},
      providers: [],
      _setup: false,
      _app: true
    });
  },

  service(location, service, options = {}) {
    location = stripSlashes(location);

    // If they didn't pass a service to initialize then we
    // must be fetching and returning the service for use.
    if (!service) {
      const current = this.services[location];

      if (typeof current === 'undefined' && typeof this.defaultService === 'function') {
        return this.service(location, this.defaultService(location), options);
      }

      return current;
    }

    let protoService = Proto.extend(service);

    debug(`Registering new service at \`${location}\``);

    // Add all the mixins for each service
    this.mixins.forEach(fn => fn.call(this, protoService));

    // If it has a setup function, run it
    if (typeof protoService._setup === 'function') {
      protoService._setup(this, location);
    }

    // Run the provider functions to register the service
    this.providers.forEach(provider =>
      provider.call(this, location, protoService, options)
    );

    // If we ran setup already, set this service up explicitly
    if (this._isSetup && typeof protoService.setup === 'function') {
      debug(`Setting up service for \`${location}\``);
      protoService.setup(this, location);
    }

    return (this.services[location] = protoService);
  },

  use(path) {
    // This is to handle the case where you have middleware that
    // you want to run before and after your service. For example,
    // 
    // app.use('/messages', middleware1, service, middleware2)
    // 
    let service, middleware = Array.from(arguments)
      .slice(1)
      .reduce(function (middleware, arg) {
        if (typeof arg === 'function') {
          middleware[service ? 'after' : 'before'].push(arg);
        } else if (!service) {
          service = arg;
        } else {
          throw new Error('Invalid arguments passed to app.use');
        }
        return middleware;
      }, {
        before: [],
        after: []
      });

    // TODO (EK): If the service is a sub-app get the parent providers and
    // middleware and apply it to me using any I have defined already as the default

    // Check to see if it is a sub-app or a service
    // (any object with at least one service method)
    if (isSubApp(service) || !isService(service)) {
      return this._super.apply(this, arguments);
    }

    // Any arguments left over are other middleware that we want to pass to the providers
    this.service(path, service, { middleware });

    return this;
  },

  setup() {
    // Setup each service (pass the app so that they can look up other services etc.)
    Object.keys(this.services).forEach(path => {
      console.log('Mount Path', this.mountpath, path);
      const service = this.services[path];

      debug(`Setting up service for \`${path}\``);
      if (typeof service.setup === 'function') {
        service.setup(this, path);
      }
    });

    this._isSetup = true;

    return this;
  },

  // Express 3.x configure is gone in 4.x but we'll keep a more basic version
  // That just takes a function in order to keep Feathers plugin configuration easier.
  // Environment specific configurations should be done as suggested in the 4.x migration guide:
  // https://github.com/visionmedia/express/wiki/Migrating-from-3.x-to-4.x
  configure(fn){
    fn.call(this);

    return this;
  },

  listen() {
    const server = this._super.apply(this, arguments);

    this.setup(server);
    debug('Feathers application listening');

    return server;
  }
};
