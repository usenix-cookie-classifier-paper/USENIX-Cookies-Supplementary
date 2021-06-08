// local counters for debugging
var debug_httpRemovalCounter = 0;
var debug_httpsRemovalCounter = 0;
var debug_classifyAllCounter = [0, 0, 0, 0];

// debug performance timers (FE, FE + Prediction)
var debug_perfsum = [0.0, 0.0, 0.0];
var debug_perfsum_squared = [0.0, 0.0, 0.0];
var debug_maxTime = [0.0, 0.0, 0.0];
var debug_minTime = [1e10, 1e10, 1e10];

var debug_Ntotal = [0, 0, 0];
var debug_Nskipped = 0;

// Variables for all the user options, which is persisted in storage.local and storage.sync
// Retrieving these from disk all the time is a bottleneck.
var ext_userpolicy = undefined;
var ext_pscale = undefined;
var ext_pause = undefined;
var ext_ulimit = undefined;
var ext_hconsent = undefined;
var ext_exglobal = undefined;
var ext_exfunc = undefined;
var ext_exanal = undefined;
var ext_exadvert = undefined;
var ext_mintime = undefined;
var ext_knowncookies = undefined;
var ext_useinternal = undefined;

// lookup for known cookies, to prevent some critical login issues
// will be imported form an external file and kept here
var knownCookies_user = undefined;
var knownCookies_internal = undefined;

// key used to access the regular expression pattern in the known_cookies object
const regexKey = "~regex;";

// indexed DB for cookie history
var historyDB = undefined;
const openDBRequest = window.indexedDB.open("CookieHistory", 1);


/**
 * Helper function to record the debug timing value.
 * @param {Number} elapsed Elapsed time in milliseconds.
 * @param {Number} idx Index to store the measurement in.
 */
 const recordDebugTimings = function(elapsed, idx) {
    if (elapsed > debug_maxTime[idx]) {
        debug_maxTime[idx] = elapsed;
    } else if (elapsed < debug_minTime[idx]) {
        debug_minTime[idx] = elapsed;
    }
    debug_perfsum[idx] += elapsed;
    debug_perfsum_squared[idx] += elapsed * elapsed;
    debug_Ntotal[idx]++;
}

/**
 * To be used in the debug console.
 */
var timingsDebug = function () {
    for (let i = 0; i < debug_Ntotal.length; i++) {
        console.log(`------------- INDEX ${i} ---------------`)
        if (debug_Ntotal[i] === 0){
            console.error(`No cookies classified for index ${i} yet!`)
        } else {
            let mean = debug_perfsum[i] / debug_Ntotal[i];
            let variance = (debug_perfsum_squared[i] / debug_Ntotal[i]) - (mean * mean);
            console.log(`Total Cookies for index ${i}: ${debug_Ntotal[i]}`);
            console.log(`Mean Time: ${mean} ms`);
            console.log(`Std-Dev Time: ${Math.sqrt(variance)} ms`);
            console.log(`Minimum Time: ${debug_minTime[i]} ms`);
            console.log(`Maximum Time: ${debug_maxTime[i]} ms`);
        }
    }
    console.log(`Number of cookies with labels already known: ${debug_Nskipped}`);
    return 0;
}


/**
 * This function reloads the current known cookies JSON from the given paths.
 * Performs requests to remote domains to retrieve the data. Correctness is also checked.
 */
 const reloadUserKnownCookies = function(cookiePaths) {
    if (cookiePaths.length === 0){
        knownCookies_user = undefined;
    } else {
        knownCookies_user = { "name_match": {}, "domain_match": {}, "domain_regex": {} }
        for (let path of cookiePaths) {
            getExtensionFile(path, "json", (result) => {
                if (typeof result === "object" && result !== null && ("name_match" in result || "domain_match" in result || "domain_regex" in result)) {
                    if ("name_match" in result) {
                        for (let k of Object.keys(result["name_match"])) {
                            knownCookies_user["name_match"][k] = result["name_match"][k];
                        }
                    }
                    if ("domain_match" in result) {
                        for (let k of Object.keys(result["domain_match"])) {
                            knownCookies_user["domain_match"][k] = result["domain_match"][k];
                        }
                    }
                    if ("domain_regex" in result) {
                        for (let k of Object.keys(result["domain_regex"])) {
                            knownCookies_user["domain_regex"][k] = result["domain_regex"][k];
                            knownCookies_user["domain_regex"][k][regexKey] = new RegExp(k);
                        }
                    }
                } else {
                    console.error(`Stored path did not point to a valid JSON: ${path}`);
                }
            });
        }
    }
}


/**
 * Helper function to restore one of the above vars if they should revert to undefined for some reason.
 * @param {*} cValue Value currently stored in the variable. If this is undefined, the variable will be restored.
 * @param {String} varName Name of the corresponding variable.
 */
const maybeRestoreCBLKVar = async function (cValue, varName) {
    if (cValue === undefined) {
        console.warn(`Variable '${varName}' undefined, retrieving from storage...`);
        switch (varName) {
            case "ext_userpolicy": ext_userpolicy = await getStorageValue(chrome.storage.sync, "ext_userpolicy"); break;
            case "ext_pscale": ext_pscale = await getStorageValue(chrome.storage.sync, "ext_pscale"); break;
            case "ext_pause" : ext_pause = await getStorageValue(chrome.storage.local, "ext_pause"); break;
            case "ext_ulimit" : ext_ulimit = await getStorageValue(chrome.storage.local, "ext_ulimit"); break;
            case "ext_hconsent" : ext_hconsent = await getStorageValue(chrome.storage.sync, "ext_hconsent"); break;
            case "ext_exglobal" : ext_exglobal = await getStorageValue(chrome.storage.sync, "ext_exglobal"); break;
            case "ext_exfunc" : ext_exfunc = await getStorageValue(chrome.storage.sync, "ext_exfunc"); break;
            case "ext_exanal" : ext_exanal = await getStorageValue(chrome.storage.sync, "ext_exanal"); break;
            case "ext_exadvert" : ext_exadvert = await getStorageValue(chrome.storage.sync, "ext_exadvert"); break;
            case "ext_mintime" : ext_mintime = await getStorageValue(chrome.storage.sync, "ext_mintime"); break;
            case "ext_knowncookies" : {
                ext_knowncookies = await getStorageValue(chrome.storage.sync, "ext_knowncookies");
                reloadUserKnownCookies(ext_knowncookies);
                break;
            }
            case "ext_useinternal" : ext_useinternal = await getStorageValue(chrome.storage.sync, "ext_useinternal"); break;
            default: throw new Error("Unrecognized variable name.");
        }
    }
}

// executed if the database is new or needs to be updated
openDBRequest.onupgradeneeded = function(event) {
    let objectStore = event.target.result.createObjectStore("cookies");
    objectStore.createIndex("name", "name", { unique: false });
    objectStore.createIndex("domain", "domain", { unique: false });
    objectStore.createIndex("path", "path", { unique: false });
    objectStore.createIndex("label", "current_label", { unique: false });
};

// success will be called after upgradeneeded
openDBRequest.onsuccess = function(ev1) {
    historyDB = ev1.target.result;
    historyDB.onerror = function(ev2) {
        console.error("Database error: " + ev2.target.errorCode);
    };
};

// if the connection failed
openDBRequest.onerror = function(event) {
    console.error(`Failed to open history database with error code: ${event.target.errorCode}`);
};


/**
 * Construct a string formatted key that uniquely identifies the given cookie object.
 * @param {Object} cookieDat Stores the cookie data, expects attributes name, domain and path.
 * @returns {String} string representing the cookie's key
 */
const constructKeyFromCookie = function(cookieDat) {
    return `${cookieDat.name};${urlToUniformDomain(cookieDat.domain)};${cookieDat.path}`;
}


/**
 * Insert serialized cookie into IndexedDB storage via a transaction.
 * @param {Object} serializedCookie Cookie to insert into storage.
 */
const insertCookieIntoStorage = function(serializedCookie) {
    if (historyDB !== undefined) {
        let ckey = constructKeyFromCookie(serializedCookie);
        let putRequest = historyDB.transaction("cookies", "readwrite").objectStore("cookies").put(serializedCookie, ckey);
        putRequest.onerror = function(event) {
            console.error(`Failed to insert cookie (${ckey}) into IndexedDB storage: ${event.target.errorCode}`);
        }
    } else {
        console.error("Could not insert cookie because database connection is closed!");
    }
}

/**
 * Retrieve serialized cookie from IndexedDB storage via a transaction.
 * @param {Object} cookieDat Raw cookie object that provides name, domain and path.
 * @returns {Promise<Object>} Either the cookie if found, or undefined if not.
 */
const retrieveCookieFromStorage = function(cookieDat) {
    if (historyDB !== undefined) {
        let ckey = constructKeyFromCookie(cookieDat);

        let request = historyDB.transaction("cookies").objectStore("cookies").get(ckey);
        return new Promise((resolve, reject) => {
            request.onerror = function(event) {
                console.error("Failed to retrieve cookie: " + ckey);
                reject(`Error on retrieving cookie (${ckey}) -- Error code ${event.target.errorCode}`);
            };
            request.onsuccess = function(event) {
                resolve(event.target.result);
            };
        });
    } else {
        console.error("Could not retrieve cookie because database connection is closed!");
        return new Promise((resolve, reject) => { reject("Database connection closed."); });
    }
}

/**
 * Retrieve the number of cookies in the current history, by label.
 * @returns {Promise<Object>} The array of label counts.
 */
const getCurrentLabelCount = function() {
    if (historyDB !== undefined) {
        let objectStore = historyDB.transaction("cookies").objectStore("cookies");
        let cursor = objectStore.index("label").openCursor();
        return new Promise((resolve, reject) => {
            let statsCount = [0, 0, 0, 0, 0];
            cursor.onsuccess = function(event) {
                var cursor = event.target.result;
                if (cursor) {
                  statsCount[cursor.value.current_label] += 1
                  cursor.continue();
                } else {
                    resolve(statsCount);
                }
            };
            cursor.onerror = (event) => { reject(event.target.errorCode) }
        });
    } else {
        console.error("Could not insert cookie because database connection is closed!");
        return new Promise((resolve, reject) => { reject("Database connection closed."); });
    }
}

/**
 * Callback function to set up config and storage defaults.
 * This initializes all chrome local and sync storage objects if undefined.
 * @param {Object} resp  Default configuration
 */
 const initDefaults = async function(dfConfig, override) {
    await setStorageValue([...dfConfig["ext_userpolicy"]], chrome.storage.sync, "ext_userpolicy", override);
    ext_userpolicy = await getStorageValue(chrome.storage.sync, "ext_userpolicy");

    await setStorageValue(dfConfig["ext_pscale"], chrome.storage.sync, "ext_pscale", override);
    ext_pscale = await getStorageValue(chrome.storage.sync, "ext_pscale");

    await setStorageValue(dfConfig["ext_pause"], chrome.storage.local, "ext_pause", override);
    ext_pause = await getStorageValue(chrome.storage.local, "ext_pause");

    await setStorageValue(dfConfig["ext_ulimit"], chrome.storage.local, "ext_ulimit", override);
    ext_ulimit = await getStorageValue(chrome.storage.local, "ext_ulimit");

    await setStorageValue(dfConfig["ext_hconsent"], chrome.storage.sync, "ext_hconsent", override);
    ext_hconsent = await getStorageValue(chrome.storage.sync, "ext_hconsent");

    await setStorageValue([...dfConfig["ext_exglobal"]], chrome.storage.sync, "ext_exglobal", override);
    ext_exglobal = await getStorageValue(chrome.storage.sync, "ext_exglobal");

    await setStorageValue([...dfConfig["ext_exfunc"]], chrome.storage.sync, "ext_exfunc", override);
    ext_exfunc = await getStorageValue(chrome.storage.sync, "ext_exfunc");

    await setStorageValue([...dfConfig["ext_exanal"]], chrome.storage.sync, "ext_exanal", override);
    ext_exanal = await getStorageValue(chrome.storage.sync, "ext_exanal");

    await setStorageValue([...dfConfig["ext_exadvert"]], chrome.storage.sync, "ext_exadvert", override);
    ext_exadvert = await getStorageValue(chrome.storage.sync, "ext_exadvert");

    await setStorageValue(dfConfig["ext_mintime"], chrome.storage.sync, "ext_mintime", override);
    ext_mintime = await getStorageValue(chrome.storage.sync, "ext_mintime");

    await setStorageValue(dfConfig["ext_knowncookies"], chrome.storage.sync, "ext_knowncookies", override);
    ext_knowncookies = await getStorageValue(chrome.storage.sync, "ext_knowncookies");
    reloadUserKnownCookies(ext_knowncookies);

    await setStorageValue(dfConfig["ext_useinternal"], chrome.storage.sync, "ext_useinternal", override);
    ext_useinternal = await getStorageValue(chrome.storage.sync, "ext_useinternal");
}


/**
 * Reset the default values no matter what is currently stored.
 * @param {Object} resp  Default configuration
 */
 const overrideDefaults = function() {
    getExtensionFile(chrome.extension.getURL("ext_data/default_config.json"), "json", (dfConfig) => {
        initDefaults(dfConfig, true);
    });
  }


/**
* Creates a new feature extraction input object from the raw cookie data.
* @param  {Object} cookie    Raw cookie data as received from the browser.
* @return {Promise<object>}  Feature Extraction input object.
*/
const createFEInput = function(cookie) {
    return {
      "name": escapeString(cookie.name),
      "domain": escapeString(cookie.domain),
      "path": escapeString(cookie.path),
      "current_label": -1,
      "label_ts": 0,
      "storeId": escapeString(cookie.storeId),
      "variable_data":
      [
        {
          "host_only": cookie.hostOnly,
          "http_only": cookie.httpOnly,
          "secure": cookie.secure,
          "session": cookie.session,
          "expirationDate": cookie.expirationDate,
          "expiry": datetimeToExpiry(cookie),
          "value": escapeString(cookie.value),
          "same_site": escapeString(cookie.sameSite),
          "timestamp": Date.now()
        }
      ]
    };
}

/**
 * Updates the existing feature extraction object with data from the new cookie.
 * Specifically, the variable data attribute will have the new cookie's data appended to it.
 * If the update limit is reached, the oldest update will be removed.
 * @param  {Object} storedFEInput   Feature Extraction input, previously constructed.
 * @param  {Object} rawCookie       New cookie data, untransformed.
 * @return {Promise<object>}        The existing cookie object, updated with new data.
 */
const updateFEInput = async function(storedFEInput, rawCookie) {
    await maybeRestoreCBLKVar(ext_ulimit, "ext_ulimit");

    let updateArray = storedFEInput["variable_data"];
    let updateLimit = ext_ulimit;

    let updateStruct = {
        "host_only": rawCookie.hostOnly,
        "http_only": rawCookie.httpOnly,
        "secure": rawCookie.secure,
        "session": rawCookie.session,
        "expiry": datetimeToExpiry(rawCookie),
        "value": escapeString(rawCookie.value),
        "same_site": escapeString(rawCookie.sameSite),
        "timestamp": Date.now()
    };

    // remove head if limit reached
    if (updateArray.length >= updateLimit)
        updateArray.shift();

    updateArray.push(updateStruct);
    console.assert(updateArray.length > 1, "Error: Performed an update without appending to the cookie?");
    console.assert(updateArray.length <= updateLimit, "Error: cookie update limit still exceeded!");

    return storedFEInput;
};


/**
 * Given a cookie, checks the hardcoded known_cookies json for predefined classes.
 * This is used to define exceptions and correct mistakes in the classification.
 * @param {Object} cookieDat Contains the current cookie's data.
 */
 const cookieLookup = function(cookieDat, knownCookiesArg) {
    let nameLookup = (cName, namesObj) => {
        if (cName in namesObj) return namesObj[cName];
        else return -1;
    };

    let cookieName = cookieDat.name;
    let cookieDomain = cleanDomain(cookieDat.domain);

    // Check name exceptions
    let label = nameLookup(cookieName, knownCookiesArg["name_match"]);
    if (label !== undefined && label !== -1) {
        return label;
    }

    // Check domain exception, then check for name
    if (cookieDomain in knownCookiesArg["domain_match"]) {
        return nameLookup(cookieName, knownCookiesArg["domain_match"][cookieDomain]);
    } else {
        for (let obj of Object.values(knownCookiesArg["domain_regex"])) {
            if (obj[regexKey].test(cookieDomain)){
                return nameLookup(cookieName, obj);
            }
        }
        return -1;
    }
}


/**
 * Using the cookie input, extract features from the cookie and classify it, retrieving a label.
 * @param  {Object} feature_input   Transformed cookie data input, for the feature extraction.
 * @return {Promise<Number>}        Cookie category label as an integer, ranging from [0,3].
 */
const classifyCookie = async function(cookieDat, feature_input) {
    await maybeRestoreCBLKVar(ext_pscale, "ext_pscale");

    // First check the user-defined known cookies list (remote)
    let label = -1;
    if (knownCookies_user) {
        label = cookieLookup(cookieDat, knownCookies_user);
    }

    // If not found, and toggle set, check internal cookies list
    if (label === -1 && ext_useinternal && knownCookies_internal) {
        label = cookieLookup(cookieDat, knownCookies_internal);
    }

    // Otherwise, perform prediction
    if (label === -1) {
        // Feature extraction timing
        let startTime = window.performance.now();
        let features = extractFeatures(feature_input);
        recordDebugTimings(window.performance.now() - startTime, 1);

        // Prediction timing
        startTime = window.performance.now();
        label = await predictClass(features, ext_pscale);
        recordDebugTimings(window.performance.now() - startTime, 2);
    } else {
        debug_Nskipped++;
    }

    if (label < 0 && label > 3) {
        throw new Error(`Predicted label exceeded valid range: ${label}`);
    }

    debug_classifyAllCounter[label] += 1;
    return label;
};


/**
 * Decides whether to keep the cookie or delete it, based on user policy.
 * @param  {Object} cookieDat   Raw cookie data as retrieved from the browser, with "storeId".
 * @param  {Number} label       Label predicted by the classifier.
 */
const makePolicyDecision = async function(cookieDat, label) {
    await maybeRestoreCBLKVar(ext_exfunc, "ext_exfunc");
    await maybeRestoreCBLKVar(ext_exanal, "ext_exanal");
    await maybeRestoreCBLKVar(ext_exadvert, "ext_exadvert");
    await maybeRestoreCBLKVar(ext_userpolicy, "ext_userpolicy");

    let cName = classIndexToString(label);

    let ckDomain = cleanDomain(escapeString(cookieDat.domain));
    let skipRejection = false;
    try {
        switch(label) {
            case 1: // functionality
                skipRejection = ext_exfunc.includes(ckDomain);
                break;
            case 2: // analytics
                skipRejection = ext_exanal.includes(ckDomain);
                break;
            case 3: // advertising
                skipRejection = ext_exadvert.includes(ckDomain);
                break;
        }
    } catch (err){
        console.error(`Failed to retrieve exception storage value. Error: ${err.message}`);
        console.error("Continuing without exceptions.")
    }

    if (skipRejection) {
        console.debug(`Cookie found on whitelist for category '${cName}': '${cookieDat.name}';'${cookieDat.domain}';'${cookieDat.path}'`);
    } else if (!ext_userpolicy[label]) {
        // First try to remove the cookie, using https as the protocol
        chrome.cookies.remove({
            "name": cookieDat.name,
            "url": "https://" + domainRemoveNoise(cookieDat.domain) + cookieDat.path,
            "storeId": cookieDat.storeId
        }, (remResultHTTPS) => {
            // check if removal was successful -- if not, retry with http protocol
            if (remResultHTTPS === null){
                remResultHTTPS = chrome.cookies.remove({
                    "name": cookieDat.name,
                    "url": "http://" + domainRemoveNoise(cookieDat.domain) + cookieDat.path,
                    "storeId": cookieDat.storeId
                }, (remResultHTTP) => {
                    if (remResultHTTP === null){
                        // If failed again, report error.
                        console.error("Removal failed: Could not find cookie (%s;%s;%s) in storage. Assigned label: (%s)", cookieDat.name, cookieDat.domain, cookieDat.path, cName);
                    } else {
                        //console.debug("Cookie (%s;%s;%s) with label (%s) has been removed successfully over HTTP protocol.", cookieDat.name, cookieDat.domain, cookieDat.path, cName);
                        debug_httpRemovalCounter += 1;
                    }
                });
            } else {
                //console.debug("Cookie (%s;%s;%s) with label (%s) has been removed successfully over HTTPS protocol.", cookieDat.name, cookieDat.domain, cookieDat.path, cName);
                debug_httpsRemovalCounter += 1;
            }
        });
    }
};


/**
 * Retrieve the cookie, classify it, then apply the policy.
 * @param {Object} newCookie Raw cookie object directly from the browser.
 * @param {Object} storeUpdate Whether
 */
 const handleCookie = async function (newCookie, storeUpdate, overrideTimeCheck){
    await maybeRestoreCBLKVar(ext_hconsent, "ext_hconsent");
    await maybeRestoreCBLKVar(ext_exglobal, "ext_exglobal");
    await maybeRestoreCBLKVar(ext_mintime, "ext_mintime");
    await maybeRestoreCBLKVar(ext_pause, "ext_pause");

    let startTime = window.performance.now();
    // First, if consent is given, check if the cookie has already been stored.
    let serializedCookie, storedCookie;
    try {
        if (ext_hconsent && (storedCookie = await retrieveCookieFromStorage(newCookie))) {
            if (storeUpdate) {
                serializedCookie = await updateFEInput(storedCookie, newCookie);
            } else {
                serializedCookie = storedCookie;
            }
        }
    } catch(err) {
        console.error("Retrieving or updating cookie failed unexpectedly.\nOriginal error: " + err.message);
    }

    // if consent not given, or cookie not present, create a new feature extraction object
    if (serializedCookie === undefined) {
        serializedCookie = createFEInput(newCookie);
    }

    // Record debug timing for cookie retrieval
    recordDebugTimings(window.performance.now() - startTime, 0);
    console.assert(serializedCookie !== undefined, "Cookie object was still undefined!");

    // Check if the domain is contained in the whitelist
    let ckDomain = cleanDomain(serializedCookie.domain);
    if (ext_exglobal.includes(ckDomain)) {
        console.debug(`Cookie found in domain whitelist: (${constructKeyFromCookie(newCookie)})`);
    } else {
        // If cookie recently classified, use previous label.
        let elapsed = Date.now() - serializedCookie["label_ts"];

        let clabel = serializedCookie["current_label"];
        console.assert(clabel !== undefined, "Stored cookie label was undefined!!");

        if (overrideTimeCheck || clabel === -1 || elapsed > ext_mintime) {
            clabel = await classifyCookie(newCookie, serializedCookie);

            // Update timestamp and label of the stored cookie
            serializedCookie["current_label"] = clabel;
            serializedCookie["label_ts"] = Date.now();
            console.debug("Perform Prediction: Cookie (%s;%s;%s) receives label (%s)", newCookie.name, newCookie.domain, newCookie.path, classIndexToString(clabel));
        } else {
            debug_Nskipped++;
            console.debug("Skip Prediction: Cookie (%s;%s;%s) with label (%s)", newCookie.name, newCookie.domain, newCookie.path, classIndexToString(clabel));
        }

        // If removal is paused, don't make the decision.
        if (ext_pause) {
            console.debug(`Pause Mode Removal Skip: Cookie Identifier: ${constructKeyFromCookie(newCookie)} -- Assigned Label: ${classIndexToString(clabel)}`);
        } else {
            makePolicyDecision(newCookie, clabel);
        }
    }

    // If consent is given, store the cookie again.
    if (ext_hconsent) {
        insertCookieIntoStorage(serializedCookie);
    }
}

/**
 * Construct a JSON document out of the contents of IndexedDB.
 * Can be complete history, or restricted to a single label.
 * @param {String} type One of (full|necessary|functional|analytics|advertising). Restricts the output to the given label.
 * @returns {Promise<object>} Promise that will yield an object representing the cookie structure.
 */
const constructHistoryJSON = function(type) {
    console.assert(historyDB !== undefined, "Cookie database link was undefined!");

    let target_label;
    switch (type) {
        case "full": target_label = null; break;
        case "necessary": target_label = 0; break;
        case "functional": target_label = 1; break;
        case "analytics": target_label = 2; break;
        case "advertising": target_label = 3; break;
        default:
            throw new Error("Incorrect label type");
    }

    let tempCookieJSON = {};
    let objectStore = historyDB.transaction("cookies").objectStore("cookies");
    let cursor = objectStore.index("domain").openCursor();
    return new Promise((resolve, reject) => {
        cursor.onsuccess = function(event) {
            var cursor = event.target.result;
            if (cursor) {
                if (target_label === null || cursor.value.current_label === target_label) {
                    let d = urlToUniformDomain(cursor.value.domain);
                    let p = cursor.value.path;
                    tempCookieJSON[d] = tempCookieJSON[d] || {};
                    tempCookieJSON[d][p] = tempCookieJSON[d][p] || {};
                    tempCookieJSON[d][p][cursor.value.name] = cursor.value;
                }
                cursor.continue();
            } else {
                resolve(tempCookieJSON);
            }
        };
        cursor.onerror = (event) => { reject(`Error Code: ${event.target.errorCode}`); }
    });
}


/**
 * Handle messages from other content scripts within the extension.
 * @param {Object} request Request object, containing the function type.
 * @param {Object} sender Sender origin.
 * @param {*} sendResponse response function
 */
const handleInternalMessage = function(request, sender, sendResponse) {
    console.debug("Background script received a message.")
    if (request.classify_all) {
        chrome.cookies.getAll({}, async (allCookies) => {
            if (chrome.runtime.lastError) {
                console.error("Encountered an error when trying to retrieve all cookies: " + chrome.runtime.lastError);
            } else {
                debug_classifyAllCounter = [0, 0, 0, 0];
                for (let cookieDat of allCookies) {
                    await handleCookie(cookieDat, false, true);
                }
                console.info(`classify_all: ${debug_classifyAllCounter}`);
                sendResponse({response: "All cookies classified and policy enforced."});
            }
        });
        return true;
    } else if (request.get_stats) {
        let sendStatsResponse = async () => {
            try {
                let statsCount = await getCurrentLabelCount();
                sendResponse({response: statsCount});
            } catch (err) {
                console.error("Failed to retrieve label count. Error : " + err.message)
                sendResponse({response: null});
            }
        };
        sendStatsResponse();
        return true;
    } else if (request.reset_storage) {
        historyDB.transaction("cookies", "readwrite").objectStore("cookies").clear();
        sendResponse({response: "Cookie history cleared."});
    } else if (request.open_json) {
        let sendJSONResponse = async () => {
            try {
                let cookieJSON = await constructHistoryJSON(request.open_json);
                sendResponse({response: cookieJSON});
            } catch (err) {
                console.error("Failed to retrieve JSON. Error : " + err.msg)
                sendResponse({response: null});
            }
        }
        sendJSONResponse();
        return true;
    } else if (request.reset_defaults) {
        overrideDefaults();
        sendResponse({response: "Defaults overridden by BG."});
    } else if (request.update_label) {
        let updateContents = request.update_label;
        let updateCookieProcess = async () => {
            actualCookie = await retrieveCookieFromStorage(updateContents);
            actualCookie.label_ts = updateContents.label_ts;
            actualCookie.current_label = updateContents.current_label;
            insertCookieIntoStorage(actualCookie);
            sendResponse({response: `Cookie label updated for: ${actualCookie.name};${actualCookie.domain};${actualCookie.path}`});
        }
        updateCookieProcess();
        return true;
    } else {
        sendResponse({response: undefined});
    }
}

chrome.runtime.onMessage.addListener(handleInternalMessage);


/**
 * Whenever storage.local or storage.sync updates, update the local
 * variables that track these as well.
 * @param {Object} changes Stores the objects that were altered.
 * @param {Object} area Storage area that was changed
 */
 const updateStorageVars = function(changes, area) {
    let changedItems = Object.keys(changes);
    if (area === "sync") {
        if (changedItems.includes("ext_userpolicy")) {
            ext_userpolicy = changes["ext_userpolicy"].newValue;
        }
        if (changedItems.includes("ext_pscale")) {
            ext_pscale = changes["ext_pscale"].newValue;
        }
        if (changedItems.includes("ext_hconsent")) {
            ext_hconsent = changes["ext_hconsent"].newValue;
        }
        if (changedItems.includes("ext_exglobal")) {
            ext_exglobal = changes["ext_exglobal"].newValue;
        }
        if (changedItems.includes("ext_exfunc")) {
            ext_exfunc = changes["ext_exfunc"].newValue;
        }
        if (changedItems.includes("ext_exanal")) {
            ext_exanal = changes["ext_exanal"].newValue;
        }
        if (changedItems.includes("ext_exadvert")) {
            ext_exadvert = changes["ext_exadvert"].newValue;
        }
        if (changedItems.includes("ext_mintime")) {
            ext_mintime = changes["ext_mintime"].newValue;
        }
        if (changedItems.includes("ext_knowncookies")) {
            ext_knowncookies = changes["ext_knowncookies"].newValue;
            reloadUserKnownCookies(ext_knowncookies);
        }
        if (changedItems.includes("ext_useinternal")) {
            ext_useinternal = changes["ext_useinternal"].newValue;
        }
    } else if (area === "local") {
        if (changedItems.includes("ext_pause")) {
            ext_pause = changes["ext_pause"].newValue;
        }
        if (changedItems.includes("ext_ulimit")) {
            ext_ulimit = changes["ext_ulimit"].newValue;
        }
    }
}

chrome.storage.onChanged.addListener(updateStorageVars);

// Load the default configuration
getExtensionFile(chrome.extension.getURL("ext_data/default_config.json"), "json", (dConfig) => {
    initDefaults(dConfig, false)
});

// Load the cookie exceptions
getExtensionFile(chrome.extension.getURL("ext_data/known_cookies.json"), "json", (result) => {
    for (let k of Object.keys(result["domain_regex"])) {
        result["domain_regex"][k][regexKey] = new RegExp(k);
    }
    knownCookies_internal = result;
});

/**
* Listener that is executed any time a cookie is added, updated or removed.
* Classifies the cookie and rejects it based on user policy.
* @param {Object} changeInfo  Contains the cookie itself, and cause info.
*/
chrome.cookies.onChanged.addListener((changeInfo) => {
    //console.log(changeInfo);
    if (!changeInfo.removed) {
        handleCookie(changeInfo.cookie, true, false);
    }
});

/**
 * Listener function that opens the first time setup when the extension is installed.
 * @param {Object} details Contains the reason for the change.
 */
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.tabs.create({"active": true, "url": "/options/setup.html"});
    }
});
