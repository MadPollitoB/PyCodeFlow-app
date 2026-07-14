/* Sprint 43.6c — MonacoEnvironment (ontbrak, waardoor Monaco geen web workers kon
   aanmaken en terugviel op de main-thread → console-warning + mogelijke UI-freezes).

   We laden de worker via een blob: URL die intern de zelf-gehoste workerMain.js importeert.
   Dit is CSP-veilig: het enforced CSP heeft `worker-src 'self' blob:` en `script-src 'self'`,
   dus geen unsafe-eval nodig. Zelf-gehost onder /monaco/min/vs (geen CDN). */
(function () {
  'use strict';
  var origin = self.location.origin;
  self.MonacoEnvironment = {
    baseUrl: origin + '/monaco/min/',
    getWorkerUrl: function (moduleId, label) {
      var code =
        'self.MonacoEnvironment = { baseUrl: "' + origin + '/monaco/min/" };\n' +
        'importScripts("' + origin + '/monaco/min/vs/base/worker/workerMain.js");';
      return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    }
  };
})();
