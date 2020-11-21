var Meld = (function () {
  var meld = {};  // contains all methods exposed publicly in the meld object
  var socketio = "";
  var messageUrl = "";
  var csrfTokenHeaderName = 'X-CSRFToken';
  var data = {};

  /*
    Initializes the meld object.
    */
  meld.init = function (_messageUrl) {
    messageUrl = _messageUrl;
    meld.socketio = io();

    meld.socketio.on('response', function(responseJson) {
       if (!responseJson) {
         return
       }

       if (responseJson.error) {
         console.error(responseJson.error);
         return
       }

       updateData(responseJson.data);
       // data = responseJson.data || {};

       var dom = responseJson.dom;

       var morphdomOptions = {
         childrenOnly: false,
         getNodeKey: function (node) {
           // A node's unique identifier. Used to rearrange elements rather than
           // creating and destroying an element that already exists.
           if (node.attributes) {
             var key = node.getAttribute("meld:key") || node.id;

             if (key) {
               return key;
             }
           }
         },
         onBeforeElUpdated: function (fromEl, toEl) {
           // When dealing with DOM nodes, we want isEqualNode, otherwise
           // isSameNode will ALWAYS return false.
           if (fromEl.isEqualNode(toEl)) {
             return false;
           }
         },
       }
      var componentRoot = $('[meld\\:id="' + responseJson.id + '"]');
      morphdom(componentRoot, dom, morphdomOptions);
  });

}

function updateData(newData){
  for (var key in newData) {
    if (_data[key] !== null){
      _data[key] = newData[key];
    }
  }
}

/*
    Gets the value of the `meld:model` attribute from an element even if there are modifiers.
    */
function getModelName(el) {
  for (var i = 0; i < el.attributes.length; i++) {
    var attribute = el.attributes[i];

    if (attribute.name.indexOf("meld:model") > -1) {
      return el.getAttribute(attribute.name);
    }
  }
}

/*
    Initializes the component.
    */
meld.componentInit = function (args) {
  var meldId = args.id;
  var componentName = args.name;
  var componentRoot = $('[meld\\:id="' + meldId + '"]');
  var rc = componentRoot.getAttribute('meld:data');
  var tmp = rc.replace(/[\"{}]/g,"").split(":");

    data[tmp[0]] = tmp[1];
    _data = data;

    if (!componentRoot) {
      Error("No id found");
    }

    var modelEls = [];

    walk(componentRoot, (el) => {
      if (el.isSameNode(componentRoot)) {
        // Skip the component root element
        return
      }

      for (var i = 0; i < el.attributes.length; i++) {
        var attribute = el.attributes[i];
        var meldIdx = attribute.name.indexOf("meld:");

        if (meldIdx > -1) {
          if (attribute.name.indexOf("meld:model") > -1) {
            modelEls.push(el);

            var attributeName = attribute.name;
            var modifiers = attributeName.replace("meld:model.", "").split(".");
            var attributeModifiers = {};

            modifiers.forEach(modifier => {
              if (modifier != "meld:model") {
                var modifierArgs = modifier.split("-");
                attributeModifiers[modifierArgs[0]] = modifierArgs.length > 1 ? modifierArgs[1] : true;
              }
            })
            var modelEventType = attributeModifiers.lazy ? "blur" : "input";
            var debounceTime = attributeModifiers.debounce ? parseInt(attributeModifiers.debounce) : -1;

            el.addEventListener(modelEventType, event => {
              var modelName = el.getAttribute(attributeName);
              var value = getValue(el);
              var id = el.id;
              var key = el.getAttribute("meld:key");
              var action = { type: "syncInput", payload: { name: modelName, value: value } };

              sendMessage(componentName, componentRoot, meldId, action, debounceTime, function () {
              });
            });
          } else {
            var eventType = attribute.name.replace("meld:", "");
            var methodName = attribute.value;

            el.addEventListener(eventType, event => {
              var id = el.id;
              var key = el.getAttribute("meld:key");
              var action = { type: "callMethod", payload: { name: methodName } };
              meld.call(componentName, methodName, args);
            });
          }
        }
      };
    });

};

/*
    Sets the data on the meld object.
    */
meld.setData = function (data) {
  data = _data;
}

/*
    Call an action on the specified component.
    */
meld.call = function (componentName, methodName,args) {
  var meldId = args.id;
  var componentName = args.name;
  var componentRoot = $('[meld\\:id="' + meldId + '"]');

  if (!componentRoot) {
    Error("No component found for: ", componentName);
  }

  var meldId = componentRoot.getAttribute('meld:id');

  if (!meldId) {
    Error("No id found");
  }


  var action = { type: "callMethod", payload: { name: methodName, params: args } };
  var modelEls = [];

  walk(componentRoot, (el) => {
    if (el.isSameNode(componentRoot)) {
      // Skip the component root element
      return
    }
  });

  sendMessage(componentName, componentRoot, meldId, action, args, function () {
  });
}

/*
    Get the CSRF token used by Django.
    */
function getCsrfToken() {
  var csrfToken = "";
  var csrfElements = document.getElementsByName('csrfmiddlewaretoken');

  if (csrfElements.length > 0) {
    csrfToken = csrfElements[0].getAttribute('value');
  }

  if (!csrfToken) {
    console.error("CSRF token is missing. Do you need to add {% csrf_token %}?");
  }

  return csrfToken;
}

/*
    Traverse the DOM looking for child elements.
    */
function walk(el, callback) {
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, null, false);

  while (walker.nextNode()) {
    // TODO: Handle sub-components
    callback(walker.currentNode);
  }
}
/*
    Get a value from an element. Tries to deal with HTML weirdnesses.
    */
function getValue(el) {
  var value = el.value;

  // Handle checkbox
  if (el.type.toLowerCase() == "checkbox") {
    value = el.checked;
  }

  // Handle multiple select options
  if (el.type.toLowerCase() == "select-multiple") {
    value = [];
    for (var i = 0; i < el.selectedOptions.length; i++) {
      value.push(el.selectedOptions[i].value);
    }
  }

  return value;
}

/*
    Handles calling the message endpoint and merging the results into the document.
    */
function sendMessage(componentName, componentRoot, meldId, action, debounceTime, callback) {
  meld.socketio.emit('message', {'id': meldId, 'action':action, 'componentName': componentName, 'data': data});
}

/*
    A simple shortcut for querySelector that everyone loves.
    */
function $(selector, scope) {
  if (scope == undefined) {
    scope = document;
  }

  return scope.querySelector(selector);
}

/*
    Returns a function, that, as long as it continues to be invoked, will not
    be triggered. The function will be called after it stops being called for
    N milliseconds. If `immediate` is passed, trigger the function on the
    leading edge, instead of the trailing.

    Derived from underscore.js's implementation in https://davidwalsh.name/javascript-debounce-function.
    */
function debounce(func, wait, immediate) {
  var timeout;

  if (typeof immediate == undefined) {
    immediate = true;
  }

  return function () {
    var context = this, args = arguments;
    var later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    var callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };
};

/*
    The function is executed the number of times it is called,
    but there is a fixed wait time before each execution.
    From https://medium.com/ghostcoder/debounce-vs-throttle-vs-queue-execution-bcde259768.
    */
const funcQueue = [];
function queue(func, waitTime) {
  let isWaiting;

  const play = () => {
    let params;
    isWaiting = false;

    if (funcQueue.length) {
      params = funcQueue.shift();
      executeFunc(params);
    }
  };

  const executeFunc = (params) => {
    isWaiting = true;
    func(params);
    setTimeout(play, waitTime);
  };

  return (params) => {
    if (isWaiting) {
      funcQueue.push(params);
    } else {
      executeFunc(params);
    }
  };
}

/*
    Allow python print
    */
function print(msg) {
  var args = [].slice.apply(arguments).slice(1);
  console.log(msg, ...args);
}

return meld;
}());