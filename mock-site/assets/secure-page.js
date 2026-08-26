(function () {
  'use strict';
  var nativeFetch = window.fetch.bind(window);
  window.fetch = async function () {
    var response = await nativeFetch.apply(window, arguments);
    if ((response.status === 401 || response.status === 428) && location.pathname !== '/login' && location.pathname !== '/login.html') {
      location.replace('/login?next=' + encodeURIComponent(location.pathname));
    }
    return response;
  };

  window.kpetroSessionReady = nativeFetch('/api/session').then(function (response) {
    return response.json();
  }).then(function (session) {
    if (!session.authenticated || session.is_first_login) {
      location.replace('/login?next=' + encodeURIComponent(location.pathname));
      return session;
    }
    window.kpetroSession = session;
    return session;
  });
})();
