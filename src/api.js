/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

PDFJS.getDocument = function getDocument(source) {
  var promise = new PDFJS.Promise();
  var transport = new WorkerTransport(promise);
  if (typeof source === 'string') {
    // fetch url
    PDFJS.getPdf(
      {
        url: source,
        progress: function getPDFProgress(evt) {
          if (evt.lengthComputable)
            promise.progress({
              loaded: evt.loaded,
              total: evt.total
            });
        },
        error: function getPDFError(e) {
          promise.reject('Unexpected server response of ' +
            e.target.status + '.');
        }
      },
      function getPDFLoad(data) {
        transport.sendData(data);
      });
  } else {
    // assuming the source is array, instantiating directly from it
    transport.sendData(source);
  }
  return promise;
};

var PDFDocumentProxy = (function() {
  function PDFDocumentProxy(pdfInfo, transport) {
    this.pdfInfo = pdfInfo;
    this.transport = transport;
  }
  PDFDocumentProxy.prototype = {
    get numPages() {
      return this.pdfInfo.numPages;
    },
    get fingerprint() {
      return this.pdfInfo.fingerprint;
    },
    getPage: function(number) {
      return this.transport.getPage(number);
    },
    getDestinations: function() {
      var promise = new PDFJS.Promise();
      var destinations = this.pdfInfo.destinations;
      promise.resolve(destinations);
      return promise;
    },
    getOutline: function() {
      var promise = new PDFJS.Promise();
      var outline = this.pdfInfo.outline;
      promise.resolve(outline);
      return promise;
    },
    getMetadata: function() {
      var promise = new PDFJS.Promise();
      var info = this.pdfInfo.info;
      var metadata = this.pdfInfo.metadata;
      promise.resolve({
        info: info,
        metadata: metadata ? new PDFJS.Metadata(metadata) : null
      });
      return promise;
    },
    destroy: function() {
      this.transport.destroy();
    }
  };
  return PDFDocumentProxy;
})();

var PDFPageProxy = (function PDFPageProxyClosure() {
  function PDFPageProxy(pageInfo, transport) {
    this.pageInfo = pageInfo;
    this.transport = transport;
    this._stats = new StatTimer();
    this.objs = transport.objs;
  }
  PDFPageProxy.prototype = {
    get pageNumber() {
      return this.pageInfo.pageIndex + 1;
    },
    get rotate() {
      return this.pageInfo.rotate;
    },
    get stats() {
      return this._stats;
    },
    get ref() {
      return this.pageInfo.ref;
    },
    get view() {
      return this.pageInfo.view;
    },
    getViewport: function(scale, rotate) {
      if (arguments.length < 2)
        rotate = this.rotate;
      return new PDFJS.PageViewport(this.view, scale, rotate, 0, 0);
    },
    getAnnotations: function() {
      var promise = new PDFJS.Promise();
      var annotations = this.pageInfo.annotations;
      promise.resolve(annotations);
      return promise;
    },
    render: function(renderContext) {
      var promise = new Promise();
      var stats = this.stats;
      stats.time('Overall');
      // If there is no displayReadyPromise yet, then the operatorList was never
      // requested before. Make the request and create the promise.
      if (!this.displayReadyPromise) {
        this.displayReadyPromise = new Promise();

        this.stats.time('Page Request');
        this.transport.messageHandler.send('RenderPageRequest', {
          pageIndex: this.pageNumber - 1
        });
      }

      var callback = (function complete(error) {
          if (error)
            promise.reject(error);
          else
            promise.resolve();
        });

      // Once the operatorList and fonts are loaded, do the actual rendering.
      this.displayReadyPromise.then(
        function pageDisplayReadyPromise() {
          var gfx = new CanvasGraphics(renderContext.canvasContext,
            this.objs, renderContext.textLayer);
          try {
            this.display(gfx, renderContext.viewport, callback);
          } catch (e) {
            if (callback)
              callback(e);
            else
              error(e);
          }
        }.bind(this),
        function pageDisplayReadPromiseError(reason) {
          if (callback)
            callback(reason);
          else
            error(reason);
        }
      );

      return promise;
    },

    startRenderingFromOperatorList:
      function PDFPageWrapper_startRenderingFromOperatorList(operatorList,
                                                             fonts) {
      var self = this;
      this.operatorList = operatorList;

      var displayContinuation = function pageDisplayContinuation() {
        // Always defer call to display() to work around bug in
        // Firefox error reporting from XHR callbacks.
        setTimeout(function pageSetTimeout() {
          self.displayReadyPromise.resolve();
        });
      };

      this.ensureFonts(fonts,
        function pageStartRenderingFromOperatorListEnsureFonts() {
          displayContinuation();
        }
      );
    },

    ensureFonts: function PDFPageWrapper_ensureFonts(fonts, callback) {
      this.stats.time('Font Loading');
      // Convert the font names to the corresponding font obj.
      for (var i = 0, ii = fonts.length; i < ii; i++) {
        fonts[i] = this.objs.objs[fonts[i]].data;
      }

      // Load all the fonts
      FontLoader.bind(
        fonts,
        function pageEnsureFontsFontObjs(fontObjs) {
          this.stats.timeEnd('Font Loading');

          callback.call(this);
        }.bind(this)
      );
    },

    display: function PDFPageWrapper_display(gfx, viewport, callback) {
      var stats = this.stats;
      stats.time('Rendering');

      gfx.beginDrawing(viewport);

      var startIdx = 0;
      var length = this.operatorList.fnArray.length;
      var operatorList = this.operatorList;
      var stepper = null;
      if (PDFJS.pdfBug && StepperManager.enabled) {
        stepper = StepperManager.create(this.pageNumber);
        stepper.init(operatorList);
        stepper.nextBreakPoint = stepper.getNextBreakPoint();
      }

      var self = this;
      function next() {
        startIdx =
          gfx.executeOperatorList(operatorList, startIdx, next, stepper);
        if (startIdx == length) {
          gfx.endDrawing();
          stats.timeEnd('Rendering');
          stats.timeEnd('Overall');
          if (callback) callback();
        }
      }
      next();
    },

    getTextContent: function() {
      var promise = new PDFJS.Promise();
      var textContent = 'page text'; // not implemented
      promise.resolve(textContent);
      return promise;
    },
    getOperationList: function() {
      var promise = new PDFJS.Promise();
      var operationList = { // not implemented
        dependencyFontsID: null,
        operatorList: null
      };
      promise.resolve(operationList);
      return promise;
    }
  };
  return PDFPageProxy;
})();

var WorkerTransport = (function WorkerTransportClosure() {
  function WorkerTransport(promise) {
    this.workerReadyPromise = promise;
    this.objs = new PDFObjects();

    this.pageCache = [];
    this.pagePromises = [];
    this.fontsLoading = {};

    // If worker support isn't disabled explicit and the browser has worker
    // support, create a new web worker and test if it/the browser fullfills
    // all requirements to run parts of pdf.js in a web worker.
    // Right now, the requirement is, that an Uint8Array is still an Uint8Array
    // as it arrives on the worker. Chrome added this with version 15.
    if (!globalScope.PDFJS.disableWorker && typeof Worker !== 'undefined') {
      var workerSrc = PDFJS.workerSrc;
      if (typeof workerSrc === 'undefined') {
        error('No PDFJS.workerSrc specified');
      }

      try {
        var worker;
        if (PDFJS.isFirefoxExtension) {
          // The firefox extension can't load the worker from the resource://
          // url so we have to inline the script and then use the blob loader.
          var bb = new MozBlobBuilder();
          bb.append(document.querySelector('#PDFJS_SCRIPT_TAG').textContent);
          var blobUrl = window.URL.createObjectURL(bb.getBlob());
          worker = new Worker(blobUrl);
        } else {
          // Some versions of FF can't create a worker on localhost, see:
          // https://bugzilla.mozilla.org/show_bug.cgi?id=683280
          worker = new Worker(workerSrc);
        }

        var messageHandler = new MessageHandler('main', worker);
        this.messageHandler = messageHandler;

        messageHandler.on('test', function transportTest(supportTypedArray) {
          if (supportTypedArray) {
            this.worker = worker;
            this.setupMessageHandler(messageHandler);
          } else {
            globalScope.PDFJS.disableWorker = true;
            this.setupFakeWorker();
          }
        }.bind(this));

        var testObj = new Uint8Array(1);
        // Some versions of Opera throw a DATA_CLONE_ERR on
        // serializing the typed array.
        messageHandler.send('test', testObj);
        return;
      } catch (e) {
        warn('The worker has been disabled.');
      }
    }
    // Either workers are disabled, not supported or have thrown an exception.
    // Thus, we fallback to a faked worker.
    globalScope.PDFJS.disableWorker = true;
    this.setupFakeWorker();
  }
  WorkerTransport.prototype = {
    destroy: function WorkerTransport_destroy() {
      if (this.worker)
        this.worker.terminate();

      this.pageCache = [];
      this.pagePromises = [];
    },
    setupFakeWorker: function WorkerTransport_setupFakeWorker() {
      // If we don't use a worker, just post/sendMessage to the main thread.
      var fakeWorker = {
        postMessage: function WorkerTransport_postMessage(obj) {
          fakeWorker.onmessage({data: obj});
        },
        terminate: function WorkerTransport_terminate() {}
      };

      var messageHandler = new MessageHandler('main', fakeWorker);
      this.setupMessageHandler(messageHandler);

      // If the main thread is our worker, setup the handling for the messages
      // the main thread sends to it self.
      WorkerMessageHandler.setup(messageHandler);
    },

    setupMessageHandler:
      function WorkerTransport_setupMessageHandler(messageHandler) {
      this.messageHandler = messageHandler;

      messageHandler.on('GetDoc', function transportDoc(data) {
        var pdfInfo = data.pdfInfo;
        var pdfDocument = new PDFDocumentProxy(pdfInfo, this);
        this.pdfDocument = pdfDocument;
        this.workerReadyPromise.resolve(pdfDocument);
      }, this);

      messageHandler.on('GetPage', function transportPage(data) {
        var pageInfo = data.pageInfo;
        var page = new PDFPageProxy(pageInfo, this);
        this.pageCache[pageInfo.pageIndex] = page;
        var promise = this.pagePromises[pageInfo.pageIndex];
        promise.resolve(page);
      }, this);

      messageHandler.on('RenderPage', function transportRender(data) {
        var page = this.pageCache[data.pageIndex];
        var depFonts = data.depFonts;

        page.stats.timeEnd('Page Request');
        page.startRenderingFromOperatorList(data.operatorList, depFonts);
      }, this);

      messageHandler.on('obj', function transportObj(data) {
        var id = data[0];
        var type = data[1];

        switch (type) {
          case 'JpegStream':
            var imageData = data[2];
            loadJpegStream(id, imageData, this.objs);
            break;
          case 'Image':
            var imageData = data[2];
            this.objs.resolve(id, imageData);
            break;
          case 'Font':
            var name = data[2];
            var file = data[3];
            var properties = data[4];

            if (file) {
              // Rewrap the ArrayBuffer in a stream.
              var fontFileDict = new Dict();
              file = new Stream(file, 0, file.length, fontFileDict);
            }

            // At this point, only the font object is created but the font is
            // not yet attached to the DOM. This is done in `FontLoader.bind`.
            var font = new Font(name, file, properties);
            this.objs.resolve(id, font);
            break;
          default:
            error('Got unkown object type ' + type);
        }
      }, this);

      messageHandler.on('PageError', function transportError(data) {
        var page = this.pageCache[data.pageNum];
        if (page.displayReadyPromise)
          page.displayReadyPromise.reject(data.error);
        else
          error(data.error);
      }, this);

      messageHandler.on('JpegDecode', function(data, promise) {
        var imageData = data[0];
        var components = data[1];
        if (components != 3 && components != 1)
          error('Only 3 component or 1 component can be returned');

        var img = new Image();
        img.onload = (function messageHandler_onloadClosure() {
          var width = img.width;
          var height = img.height;
          var size = width * height;
          var rgbaLength = size * 4;
          var buf = new Uint8Array(size * components);
          var tmpCanvas = createScratchCanvas(width, height);
          var tmpCtx = tmpCanvas.getContext('2d');
          tmpCtx.drawImage(img, 0, 0);
          var data = tmpCtx.getImageData(0, 0, width, height).data;

          if (components == 3) {
            for (var i = 0, j = 0; i < rgbaLength; i += 4, j += 3) {
              buf[j] = data[i];
              buf[j + 1] = data[i + 1];
              buf[j + 2] = data[i + 2];
            }
          } else if (components == 1) {
            for (var i = 0, j = 0; i < rgbaLength; i += 4, j++) {
              buf[j] = data[i];
            }
          }
          promise.resolve({ data: buf, width: width, height: height});
        }).bind(this);
        var src = 'data:image/jpeg;base64,' + window.btoa(imageData);
        img.src = src;
      });
    },

    sendData: function WorkerTransport_sendData(data) {
      this.messageHandler.send('GetDocRequest', data);
    },

    getPage: function WorkerTransport_getPage(pageNumber, promise) {
      var pageIndex = pageNumber - 1;
      if (pageIndex in this.pagePromises)
        return this.pagePromises[pageIndex];
      var promise = new PDFJS.Promise('Page ' + pageNumber);
      this.pagePromises[pageIndex] = promise;
      this.messageHandler.send('GetPageRequest', { pageIndex: pageIndex });
      return promise;
    }
  };
  return WorkerTransport;

})();