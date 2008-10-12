/***** BEGIN LICENSE BLOCK ***** {{{
Version: MPL 1.1/GPL 2.0/LGPL 2.1

The contents of this file are subject to the Mozilla Public License Version
1.1 (the "License"); you may not use this file except in compliance with
the License. You may obtain a copy of the License at
http://www.mozilla.org/MPL/

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
for the specific language governing rights and limitations under the
License.

(c) 2006-2008: Martin Stubenschrott <stubenschrott@gmx.net>

Alternatively, the contents of this file may be used under the terms of
either the GNU General Public License Version 2 or later (the "GPL"), or
the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
in which case the provisions of the GPL or the LGPL are applicable instead
of those above. If you wish to allow use of your version of this file only
under the terms of either the GPL or the LGPL, and not to allow others to
use your version of this file under the terms of the MPL, indicate your
decision by deleting the provisions above and replace them with the notice
and other provisions required by the GPL or the LGPL. If you do not delete
the provisions above, a recipient may use your version of this file under
the terms of any one of the MPL, the GPL or the LGPL.
}}} ***** END LICENSE BLOCK *****/

const liberator = (function () //{{{
{
    ////////////////////////////////////////////////////////////////////////////////
    ////////////////////// PRIVATE SECTION /////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    const threadManager = Components.classes["@mozilla.org/thread-manager;1"]
                                    .getService(Components.interfaces.nsIThreadManager);

    var callbacks = [];
    var observers = [];

    function loadModule(name, func)
    {
        var message = "Loading module " + name + "...";
        try
        {
            liberator.log(message, 0);
            liberator.dump(message);
            liberator[name] = func();
        }
        catch (e)
        {
            toJavaScriptConsole();
            if (Components.utils.reportError)
                Components.utils.reportError(e);
            liberator.dump(e);
        }
    }

    // Only general options are added here, which are valid for all vimperator like extensions
    function addOptions()
    {
         const tabopts = [
             ["n", "Tab number", null, ".hl-TabNumber"],
             ["N", "Tab number over icon", null, ".hl-TabIconNumber"],
         ];
        liberator.options.add(["guioptions", "go"],
            "Show or hide certain GUI elements like the menu or toolbar",
            "charlist", liberator.config.defaults.guioptions || "",
            {
                setter: function (value)
                {
                    var guioptions = liberator.config.guioptions || {};

                    for (let option in guioptions)
                    {
                        if (option in guioptions)
                        {
                            guioptions[option].forEach(function (elem) {
                                try
                                {
                                    document.getElementById(elem).collapsed = (value.indexOf(option.toString()) < 0);
                                }
                                catch (e) {}
                            });
                        }
                    }
                    let classes = tabopts.filter(function (o) value.indexOf(o[0]) == -1)
                                         .map(function (a) a[3])
                    if (!classes.length)
                        liberator.storage.styles.removeSheet("taboptions", null, null, null, true);
                    else
                        liberator.storage.styles.addSheet("taboptions", "chrome://*", classes.join(",") + "{ display: none; }", true, true);

                    return value;
                },
                completer: function (filter)
                {
                    return [
                        ["m", "Menubar"],
                        ["T", "Toolbar"],
                        ["b", "Bookmark bar"]
                    ].concat(!liberator.has("tabs") ? [] : tabopts);
                },
                validator: function (value) Array.every(value, function (c) c in liberator.config.guioptions || tabopts.some(function (a) a[0] == c)),
            });

        liberator.options.add(["helpfile", "hf"],
            "Name of the main help file",
            "string", "intro.html");

        liberator.options.add(["loadplugins", "lpl"],
            "Load plugin scripts when starting up",
            "boolean", true);

        liberator.options.add(["verbose", "vbs"],
            "Define which info messages are displayed",
            "number", 0,
            { validator: function (value) value >= 0 && value <= 15 });

        liberator.options.add(["visualbell", "vb"],
            "Use visual bell instead of beeping on errors",
            "boolean", false,
            {
                setter: function (value)
                {
                    liberator.options.setPref("accessibility.typeaheadfind.enablesound", !value);
                    return value;
                }
            });
    }

    function addMappings()
    {
        liberator.mappings.add(liberator.modes.all, ["<F1>"],
            "Open help window",
            function () { liberator.help(); });

        if (liberator.has("session"))
        {
            liberator.mappings.add([liberator.modes.NORMAL], ["ZQ"],
                "Quit and don't save the session",
                function () { liberator.quit(false); });
        }

        liberator.mappings.add([liberator.modes.NORMAL], ["ZZ"],
            "Quit and save the session",
            function () { liberator.quit(true); });
    }

    function addCommands()
    {
        liberator.commands.add(["addo[ns]"],
            "Manage available Extensions and Themes",
            function ()
            {
                liberator.open("chrome://mozapps/content/extensions/extensions.xul",
                    (liberator.options["newtab"] && liberator.options.get("newtab").has("all", "addons"))
                        ? liberator.NEW_TAB: liberator.CURRENT_TAB);
            },
            { argCount: "0" });

        liberator.commands.add(["beep"],
            "Play a system beep",
            function () { liberator.beep(); },
            { argCount: "0" });

        liberator.commands.add(["dia[log]"],
            "Open a " + liberator.config.name + " dialog",
            function (args)
            {
                args = args.arguments[0];

                try
                {
                    var dialogs = liberator.config.dialogs || [];
                    for (let i = 0; i < dialogs.length; i++)
                    {
                        if (dialogs[i][0] == args)
                            return dialogs[i][2]();
                    }
                    liberator.echoerr(args ? "Dialog \"" + args + "\" not available" : "E474: Invalid argument");
                }
                catch (e)
                {
                    liberator.echoerr("Error opening '" + args + "': " + e);
                }
            },
            {
                argCount: "1",
                bang: true,
                completer: function (filter) liberator.completion.dialog(filter)
            });

        // TODO: move this
        function getMenuItems()
        {
            var menubar = document.getElementById(liberator.config.guioptions["m"]);
            var items = [];

            for (let i = 0; i < menubar.childNodes.length; i++)
            {
                (function (item, path)
                {
                    if (item.childNodes.length == 0 && item.localName == "menuitem"
                        && !/rdf:http:/.test(item.label)) // FIXME
                    {
                        item.fullMenuPath = path += item.label;
                        items.push(item);
                    }
                    else
                    {
                        if (item.localName == "menu")
                            path += item.label + ".";

                        for (let j = 0; j < item.childNodes.length; j++)
                            arguments.callee(item.childNodes[j], path);
                    }
                })(menubar.childNodes[i], "");
            }

            return items;
        }

        liberator.commands.add(["em[enu]"],
            "Execute the specified menu item from the command line",
            function (args)
            {
                var item = args.string;
                var items = getMenuItems();

                if (!items.some(function (i) i.fullMenuPath == item))
                {
                    liberator.echoerr("E334: Menu not found: " + item);
                    return;
                }

                for (let i = 0; i < items.length; i++)
                {
                    if (items[i].fullMenuPath == item)
                        items[i].doCommand();
                }
            },
            {
                argCount: "+", // NOTE: single arg may contain unescaped whitespace
                // TODO: add this as a standard menu completion function
                completer: function (filter)
                {
                    let completions = getMenuItems().map(function (item) [item.fullMenuPath, item.label]);
                    return [0, liberator.completion.filter(completions, filter)];
                }
            });

        liberator.commands.add(["exe[cute]"],
            "Execute the argument as an Ex command",
            // FIXME: this should evaluate each arg separately then join
            // with " " before executing.
            // E.g. :execute "source" io.getRCFile().path
            // Need to fix commands.parseArgs which currently strips the quotes
            // from quoted args
            function (args)
            {
                try
                {
                    var cmd = liberator.eval(args);
                    liberator.execute(cmd);
                }
                catch (e)
                {
                    liberator.echoerr(e);
                    return;
                }
            });

        liberator.commands.add(["exu[sage]"],
            "List all Ex commands with a short description",
            function (args, special)
            {
                if (!special)
                {
                    liberator.help("ex-cmd-index");
                }
                else
                {
                    // TODO: clicking on these should open the help
                    var usage = liberator.template.usage(liberator.commands);
                    liberator.echo(usage, liberator.commandline.FORCE_MULTILINE);
                }
            },
            {
                argCount: "0",
                bang: true
            });

        liberator.commands.add(["h[elp]"],
            "Display help",
            function (args, special)
            {
                if (special)
                {
                    liberator.echoerr("E478: Don't panic!");
                    return;
                }

                liberator.help(args);
            },
            {
                bang: true,
                completer: function (filter) liberator.completion.help(filter)
            });

        liberator.commands.add(["javas[cript]", "js"],
            "Run a JavaScript command through eval()",
            function (args, special)
            {
                if (special) // open javascript console
                {
                    liberator.open("chrome://global/content/console.xul",
                        (liberator.options["newtab"] && liberator.options.get("newtab").has("all", "javascript"))
                            ? liberator.NEW_TAB : liberator.CURRENT_TAB);
                }
                else
                {
                    try
                    {
                        liberator.eval(args);
                    }
                    catch (e)
                    {
                        liberator.echoerr(e);
                    }
                }
            },
            {
                bang: true,
                completer: function (filter) liberator.completion.javascript(filter),
                hereDoc: true,
            });

        liberator.commands.add(["loadplugins", "lpl"],
            "Load all plugins immediately",
            function () { liberator.loadPlugins(); });

        liberator.commands.add(["norm[al]"],
            "Execute Normal mode commands",
            function (args, special) { liberator.events.feedkeys(args.string, special); },
            {
                argCount: "+",
                bang: true
            });

        liberator.commands.add(["optionu[sage]"],
            "List all options with a short description",
            function (args, special)
            {
                if (!special)
                {
                    liberator.help("option-index");
                }
                else
                {
                    // TODO: clicking on these should open the help
                    var usage = liberator.template.usage(liberator.options);
                    liberator.echo(usage, liberator.commandline.FORCE_MULTILINE);
                }
            },
            {
                argCount: "0",
                bang: true
            });

        liberator.commands.add(["q[uit]"],
            liberator.has("tabs") ? "Quit current tab" : "Quit application",
            function (args, special)
            {
                if (liberator.has("tabs"))
                    liberator.tabs.remove(getBrowser().mCurrentTab, 1, false, 1);
                else
                    liberator.quit(false, special);
            },
            {
                argCount: "0",
                bang: true
            });

        liberator.commands.add(["res[tart]"],
            "Force " + liberator.config.name + " to restart",
            function () { liberator.restart(); },
            { argCount: "0" });

        liberator.commands.add(["time"],
            "Profile a piece of code or run a command multiple times",
            function (args, special, count)
            {
                args = args.string;
                let method = args[0] == ":" ? "execute" : "eval";

                try
                {
                    if (count > 1)
                    {
                        let total = 0;
                        var beforeTime = Date.now();

                        for (let i in liberator.util.rangeInterruptable(0, count, 500))
                        {
                            let now = Date.now();
                            liberator[method](args);
                            total += Date.now() - now;
                        }

                        if (special)
                            return;

                        if (total / count >= 100)
                        {
                            var each = (total / 1000.0) / count;
                            var eachUnits = "sec";
                        }
                        else
                        {
                            var each = total / count;
                            var eachUnits = "msec";
                        }

                        if (total >= 100)
                        {
                            var total = total / 1000.0;
                            var totalUnits = "sec";
                        }
                        else
                        {
                            var totalUnits = "msec";
                        }

                        var str = liberator.template.generic(
                                <table>
                                    <tr class="hl-Title" align="left">
                                        <th colspan="3">Code execution summary</th>
                                    </tr>
                                    <tr><td>  Executed:</td><td align="right"><span class="times-executed">{count}</span></td><td>times</td></tr>
                                    <tr><td>  Average time:</td><td align="right"><span class="time-average">{each.toFixed(2)}</span></td><td>{eachUnits}</td></tr>
                                    <tr><td>  Total time:</td><td align="right"><span class="time-total">{total.toFixed(2)}</span></td><td>{totalUnits}</td></tr>
                                </table>);
                        liberator.commandline.echo(str, liberator.commandline.HL_NORMAL, liberator.commandline.FORCE_MULTILINE);
                    }
                    else
                    {
                        var beforeTime = Date.now();
                        if (args && args[0] == ":")
                            liberator.execute(args);
                        else
                            liberator.eval(args);

                        if (special)
                            return;

                        var afterTime = Date.now();

                        if (afterTime - beforeTime >= 100)
                            liberator.echo("Total time: " + ((afterTime - beforeTime) / 1000.0).toFixed(2) + " sec");
                        else
                            liberator.echo("Total time: " + (afterTime - beforeTime) + " msec");
                    }
                }
                catch (e)
                {
                    liberator.echoerr(e);
                }
            },
            {
                argCount: "+",
                bang: true,
                completer: function (filter)
                {
                    if (/^:/.test(filter))
                        return liberator.completion.ex(filter);
                    else
                        return liberator.completion.javascript(filter);
                },
                count: true
            });

        liberator.commands.add(["ve[rsion]"],
            "Show version information",
            function (args, special)
            {
                if (special)
                    liberator.open("about:");
                else
                    liberator.echo(":" + liberator.util.escapeHTML(liberator.commandline.getCommand()) + "\n" +
                                    liberator.config.name + " " + liberator.version +
                                    " running on:\n" + navigator.userAgent);
            },
            {
                argCount: "0",
                bang: true
            });

        liberator.commands.add(["viu[sage]"],
            "List all mappings with a short description",
            function (args, special)
            {
                if (!special)
                {
                    liberator.help("normal-index");
                }
                else
                {
                    // TODO: clicking on these should open the help
                    var usage = liberator.template.usage(liberator.mappings);
                    liberator.echo(usage, liberator.commandline.FORCE_MULTILINE);
                }
            },
            {
                argCount: "0",
                bang: true
            });
    }

    // initially hide all GUI, it is later restored unless the user has :set go= or something
    // similar in his config
    function hideGUI()
    {
        var guioptions = liberator.config.guioptions || {};
        for (let option in guioptions)
        {
            guioptions[option].forEach(function (elem) {
                try
                {
                    document.getElementById(elem).collapsed = true;
                }
                catch (e) {}
            });
        }
    }

    /////////////////////////////////////////////////////////////////////////////}}}
    ////////////////////// PUBLIC SECTION //////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    return {

        get mode()      liberator.modes.main,
        set mode(value) liberator.modes.main = value,

        // Global constants
        CURRENT_TAB: 1,
        NEW_TAB: 2,
        NEW_BACKGROUND_TAB: 3,
        NEW_WINDOW: 4,

        forceNewTab: false,

        // ###VERSION### and ###DATE### are replaced by the Makefile
        version: "###VERSION### (created: ###DATE###)",

        // TODO: move to events.js?
        input: {
            buffer: "",                // partial command storage
            pendingMotionMap: null,    // e.g. "d{motion}" if we wait for a motion of the "d" command
            pendingArgMap: null,       // pending map storage for commands like m{a-z}
            count: -1                  // parsed count from the input buffer
        },

        // @param type can be:
        //  "submit": when the user pressed enter in the command line
        //  "change"
        //  "cancel"
        //  "complete"
        //  TODO: "zoom": if the zoom value of the current buffer changed
        //  TODO: move to ui.js?
        registerCallback: function (type, mode, func)
        {
            // TODO: check if callback is already registered
            callbacks.push([type, mode, func]);
        },

        triggerCallback: function (type, mode, data)
        {
            //liberator.dump("type: " + type + " mode: " + mode + "data: " + data + "\n");
            for (let i = 0; i < callbacks.length; i++)
            {
                var [thistype, thismode, thisfunc] = callbacks[i];
                if (mode == thismode && type == thistype)
                    return thisfunc.call(this, data);
            }
            return false;
        },

        registerObserver: function (type, callback)
        {
            observers.push([type, callback]);
        },

        triggerObserver: function (type, data)
        {
            for (let [,[thistype, callback]] in Iterator(observers))
            {
                if (thistype == type)
                    callback(data);
            }
        },

        beep: function ()
        {
            if (liberator.options["visualbell"])
            {
                // flash the visual bell
                let popup = document.getElementById("liberator-visualbell");
                let win = liberator.config.visualbellWindow;
                let box = document.getBoxObjectFor(win);

                popup.openPopup(win, "overlap", 0, 0, false, false);
                popup.sizeTo(box.width - 2, box.height - 2);
                setTimeout(function () { popup.hidePopup(); }, 20);
            }
            else
            {
                let soundService = Components.classes["@mozilla.org/sound;1"]
                                             .getService(Components.interfaces.nsISound);
                soundService.beep();
            }
            return false; // so you can do: if (...) return liberator.beep();
        },

        // NOTE: "browser.dom.window.dump.enabled" preference needs to be set
        dump: function (message)
        {
            if (typeof message == "object")
                message = liberator.util.objectToString(message);
            else
                message += "\n";
            dump(liberator.config.name.toLowerCase() + ": " + message);
        },

        dumpStack: function (msg)
        {
            liberator.dump((msg || "") + (new Error()).stack.replace(/.*\n/, ""));
        },

        // with (liberator) means, liberator is the default namespace "inside" eval
        eval: function (str)
        {
            const fileName = "chrome://liberator/content/liberator.js";
            const line = new Error().lineNumber + 3;
            try
            {
                return eval("with (liberator) {" + str + "}");
            }
            catch (e)
            {
                if (e.fileName == fileName && e.lineNumber >= line)
                {
                    e.source = str;
                    e.fileName = "<Evaled string>";
                    e.lineNumber -= line;
                }
                throw e;
            }
        },

        // Execute an Ex command like str=":zoom 300"
        execute: function (str, modifiers)
        {
            // skip comments and blank lines
            if (/^\s*("|$)/.test(str))
                return;

            modifiers = modifiers || {};

            let err = null;
            let [count, cmd, special, args] = liberator.commands.parseCommand(str.replace(/^'(.*)'$/, "$1"));
            let command = liberator.commands.get(cmd);

            if (command === null)
            {
                err = "E492: Not a " + liberator.config.name.toLowerCase() + " command: " + str;
                liberator.focusContent();
            }
            else if (command.action === null)
            {
                err = "E666: Internal error: command.action === null"; // TODO: need to perform this test? -- djk
            }
            else if (count != -1 && !command.count)
            {
                err = "E481: No range allowed";
            }
            else if (special && !command.bang)
            {
                err = "E477: No ! allowed";
            }

            if (!err)
                command.execute(args, special, count, modifiers);
            else
                liberator.echoerr(err);
        },

        // TODO: move to liberator.buffer.focus()?
        // after pressing Escape, put focus on a non-input field of the browser document
        // if clearFocusedElement, also blur a focused link
        focusContent: function (clearFocusedElement)
        {
            var ww = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                     .getService(Components.interfaces.nsIWindowWatcher);
            if (window == ww.activeWindow && document.commandDispatcher.focusedElement && clearFocusedElement)
                document.commandDispatcher.focusedElement.blur();

            // TODO: make more generic
            try
            {
                if (liberator.has("mail") && clearFocusedElement && !liberator.config.isComposeWindow)
                {
                    var i = gDBView.selection.currentIndex;
                    if (i == -1 && gDBView.rowCount >= 0)
                        i = 0;

                    gDBView.selection.select(i);
                }
            }
            catch (e) {}

            var elem = liberator.config.mainWidget || window.content;
            if (elem && (elem != document.commandDispatcher.focusedElement))
                elem.focus();
        },

        // partial sixth level expression evaluation
        // TODO: what is that really needed for, and where could it be used?
        //       Or should it be removed? (c) Viktor
        //       Better name?  See other liberator.eval()
        evalExpression: function (string)
        {
            string = string.toString().replace(/^\s*/, "").replace(/\s*$/, "");
            var matches = string.match(/^&(\w+)/);
            if (matches)
            {
                var opt = this.options.get(matches[1]);
                if (!opt)
                {
                    this.echoerr("E113: Unknown option: " + matches[1]);
                    return;
                }
                var type = opt.type;
                var value = opt.getter();
                if (type != "boolean" && type != "number")
                    value = value.toString();
                return value;
            }

            // String
            else if (matches = string.match(/^(['"])([^\1]*?[^\\]?)\1/))
            {
                if (matches)
                    return matches[2].toString();
                else
                {
                    this.echoerr("E115: Missing quote: " + string);
                    return;
                }
            }

            // Number
            else if (matches = string.match(/^(\d+)$/))
            {
                return parseInt(match[1], 10);
            }

            var reference = this.variableReference(string);
            if (!reference[0])
                this.echoerr("E121: Undefined variable: " + string);
            else
                return reference[0][reference[1]];

            return;
        },

        variableReference: function (string)
        {
            if (!string)
                return [null, null, null];

            var matches = string.match(/^([bwtglsv]):(\w+)/);
            if (matches) // Variable
            {
                // Other variables should be implemented
                if (matches[1] == "g")
                {
                    if (matches[2] in this.globalVariables)
                        return [this.globalVariables, matches[2], matches[1]];
                    else
                        return [null, matches[2], matches[1]];
                }
            }
            else // Global variable
            {
                if (string in this.globalVariables)
                    return [this.globalVariables, string, "g"];
                else
                    return [null, string, "g"];
            }
        },

        echo: function (str, flags)
        {
            liberator.commandline.echo(str, liberator.commandline.HL_NORMAL, flags);
        },

        // TODO: Vim replaces unprintable characters in echoerr/echomsg
        echoerr: function (str, flags)
        {
            flags |= liberator.commandline.APPEND_TO_MESSAGES;

            if (typeof str == "object" && "echoerr" in str)
                str = str.echoerr;
            else if (str instanceof Error)
                str = str.fileName + ":" + str.lineNumber + ": " + str;

            liberator.commandline.echo(str, liberator.commandline.HL_ERRORMSG, flags);
        },

        // TODO: add proper level constants
        echomsg: function (str, verbosity, flags)
        {
            flags |= liberator.commandline.APPEND_TO_MESSAGES;

            if (verbosity == null)
                verbosity = 0; // verbosity level is exclusionary

            if (liberator.options["verbose"] >= verbosity)
                liberator.commandline.echo(str, liberator.commandline.HL_INFOMSG, flags);
        },

        // return true, if this VIM-like extension has a certain feature
        has: function (feature)
        {
            var features = liberator.config.features || [];
            return features.some(function (feat) feat == feature);
        },

        help: function (topic)
        {
            var where = (liberator.options["newtab"] && liberator.options.get("newtab").has("all", "help"))
                            ? liberator.NEW_TAB : liberator.CURRENT_TAB;

            if (!topic)
            {
                var helpFile = liberator.options["helpfile"];

                if (liberator.config.helpFiles.indexOf(helpFile) != -1)
                    liberator.open("chrome://liberator/locale/" + helpFile, where);
                else
                    liberator.echo("Sorry, help file \"" + helpFile + "\" not found");

                return;
            }

            function jumpToTag(file, tag)
            {
                liberator.open("chrome://liberator/locale/" + file, where);
                // TODO: it would be better wo wait for pageLoad
                setTimeout(function () {
                    var elem = liberator.buffer.getElement('@class="tag" and text()="' + tag + '"');
                    if (elem)
                        window.content.scrollTo(0, elem.getBoundingClientRect().top - 10); // 10px context
                    else
                        liberator.dump('no element: ' + '@class="tag" and text()="' + tag + '"\n' );
                }, 500);
            }

            var [, items] = liberator.completion.help(topic);
            var partialMatch = -1;

            for (let i = 0; i < items.length; i++)
            {
                if (items[i][0] == topic)
                {
                    jumpToTag(items[i][1], items[i][0]);
                    return;
                }
                else if (partialMatch == -1 && items[i][0].indexOf(topic) > -1)
                {
                    partialMatch = i;
                }
            }

            if (partialMatch > -1)
                jumpToTag(items[partialMatch][1], items[partialMatch][0]);
            else
                liberator.echoerr("E149: Sorry, no help for " + topic);
        },

        globalVariables: {},

        loadModule: function (name, func) { loadModule(name, func); },

        loadPlugins: function ()
        {
            // FIXME: largely duplicated for loading macros
            try
            {
                let dirs = liberator.io.getRuntimeDirectories("plugin");

                if (dirs.length > 0)
                {
                    for (let [,dir] in Iterator(dirs))
                    {
                        // TODO: search plugins/**/* for plugins
                        liberator.echomsg("Searching for \"plugin/*.{js,vimp}\" in \"" + dir.path + "\"", 2);

                        liberator.log("Sourcing plugin directory: " + dir.path + "...", 3);

                        let files = liberator.io.readDirectory(dir.path, true);

                        files.forEach(function (file) {
                            if (!file.isDirectory() && /\.(js|vimp)$/i.test(file.path) && !(file.path in liberator.pluginFiles))
                            {
                                try
                                {
                                    liberator.io.source(file.path, false);
                                    liberator.pluginFiles[file.path] = true;
                                }
                                catch (e) {};
                            }
                        });
                    }
                }
                else
                {
                    liberator.log("No user plugin directory found", 3);
                }
            }
            catch (e)
            {
                // thrown if directory does not exist
                liberator.log("Error sourcing plugin directory: " + e, 9);
            }
        },

        // logs a message to the javascript error console
        // if msg is an object, it is beautified
        // TODO: add proper level constants
        log: function (msg, level)
        {
            var verbose = 0;
            if (typeof level != "number") // XXX
                level = 1;

            // liberator.options does not exist at the very beginning
            if (liberator.options)
                verbose = liberator.options.getPref("extensions.liberator.loglevel", 0);

            if (level > verbose)
                return;

            if (typeof msg == "object")
                msg = liberator.util.objectToString(msg, false);

            var consoleService = Components.classes["@mozilla.org/consoleservice;1"]
                                           .getService(Components.interfaces.nsIConsoleService);
            consoleService.logStringMessage(liberator.config.name.toLowerCase() + ": " + msg);
        },

        // open one or more URLs
        //
        // @param urls: either a string or an array of urls
        //              The array can look like this:
        //              ["url1", "url2", "url3", ...] or:
        //              [["url1", postdata1], ["url2", postdata2], ...]
        // @param where: if ommited, CURRENT_TAB is assumed
        //                  but NEW_TAB is set when liberator.forceNewTab is true.
        // @param force: Don't prompt whether to open more than 20 tabs.
        // @returns true when load was initiated, or false on error
        open: function (urls, where, force)
        {
            // convert the string to an array of converted URLs
            // -> see liberator.util.stringToURLArray for more details
            if (typeof urls == "string")
                urls = liberator.util.stringToURLArray(urls);

            if (urls.length > 20 && !force)
            {
                liberator.commandline.input("This will open " + urls.length + " new tabs. Would you like to continue? (yes/[no])",
                    function (resp) { if (resp && resp.match(/^y(es)?$/i)) liberator.open(urls, where, true); });
                return true;
            }

            if (urls.length == 0)
                return false;

            if (liberator.forceNewTab && liberator.has("tabs"))
                where = liberator.NEW_TAB;
            else if (!where || !liberator.has("tabs"))
                where = liberator.CURRENT_TAB;

            var url = typeof urls[0] == "string" ? urls[0] : urls[0][0];
            var postdata = typeof urls[0] == "string" ? null : urls[0][1];
            var whichwindow = window;

            // decide where to load the first url
            switch (where)
            {
                case liberator.CURRENT_TAB:
                    getBrowser().loadURIWithFlags(url, null, null, null, postdata);
                    break;

                case liberator.NEW_TAB:
                    var firsttab = getBrowser().addTab(url, null, null, postdata);
                    getBrowser().selectedTab = firsttab;
                    break;

                case liberator.NEW_BACKGROUND_TAB:
                    getBrowser().addTab(url, null, null, postdata);
                    break;

                case liberator.NEW_WINDOW:
                    window.open();
                    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                                       .getService(Components.interfaces.nsIWindowMediator);
                    whichwindow = wm.getMostRecentWindow("navigator:browser");
                    whichwindow.loadURI(url, null, postdata);
                    break;

                default:
                    liberator.echoerr("Exxx: Invalid 'where' directive in liberator.open(...)");
                    return false;
            }

            // only load more than one url if we have tab support
            if (!liberator.has("tabs"))
                return true;

            // all other URLs are always loaded in background
            for (let i = 1; i < urls.length; i++)
            {
                url = typeof urls[i] == "string" ? urls[i] : urls[i][0];
                postdata = typeof urls[i] == "string" ? null : urls[i][1];
                whichwindow.getBrowser().addTab(url, null, null, postdata);
            }

            return true;
        },

        // namespace for plugins/scripts. Actually (only) the active plugin must/can set a
        // v.plugins.mode = <str> string to show on v.modes.CUSTOM
        // v.plugins.stop = <func> hooked on a v.modes.reset()
        // v.plugins.onEvent = <func> function triggered, on keypresses (unless <esc>) (see events.js)
        plugins: {},

        pluginFiles: {},

        // quit liberator, no matter how many tabs/windows are open
        quit: function (saveSession, force)
        {
            if (saveSession)
                liberator.options.setPref("browser.startup.page", 3); // start with saved session
            else
                liberator.options.setPref("browser.startup.page", 1); // start with default homepage session

            const nsIAppStartup = Components.interfaces.nsIAppStartup;
            if (force)
                Components.classes["@mozilla.org/toolkit/app-startup;1"]
                          .getService(nsIAppStartup)
                          .quit(nsIAppStartup.eForceQuit);
            else
                goQuitApplication();
        },

        restart: function ()
        {
            const nsIAppStartup = Components.interfaces.nsIAppStartup;

            // notify all windows that an application quit has been requested.
            var os = Components.classes["@mozilla.org/observer-service;1"]
                               .getService(Components.interfaces.nsIObserverService);
            var cancelQuit = Components.classes["@mozilla.org/supports-PRBool;1"]
                                       .createInstance(Components.interfaces.nsISupportsPRBool);
            os.notifyObservers(cancelQuit, "quit-application-requested", null);

            // something aborted the quit process.
            if (cancelQuit.data)
                return;

            // notify all windows that an application quit has been granted.
            os.notifyObservers(null, "quit-application-granted", null);

            // enumerate all windows and call shutdown handlers
            var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                               .getService(Components.interfaces.nsIWindowMediator);
            var windows = wm.getEnumerator(null);
            while (windows.hasMoreElements())
            {
                var win = windows.getNext();
                if (("tryToClose" in win) && !win.tryToClose())
                    return;
            }
            Components.classes["@mozilla.org/toolkit/app-startup;1"]
                      .getService(nsIAppStartup)
                      .quit(nsIAppStartup.eRestart | nsIAppStartup.eAttemptQuit);
        },

        // TODO: move to {muttator,vimperator,...}.js
        // this function is called when the chrome is ready
        startup: function ()
        {
            liberator.log("Initializing liberator object...", 0);

            // components which should be shared across all windows
            Components.utils.import("resource://liberator/storage.jsm", liberator);

            // commands must always be the first module to be initialized
            loadModule("commands",     liberator.Commands); addCommands();
            loadModule("options",      liberator.Options);  addOptions();
            loadModule("mappings",     liberator.Mappings); addMappings();
            loadModule("buffer",       liberator.Buffer);
            loadModule("events",       liberator.Events);
            loadModule("commandline",  liberator.CommandLine);
            loadModule("statusline",   liberator.StatusLine);
            loadModule("editor",       liberator.Editor);
            loadModule("autocommands", liberator.AutoCommands);
            loadModule("io",           liberator.IO);
            loadModule("completion",   liberator.Completion);

            // This adds options/mappings/commands which are only valid in this particular extension
            if (liberator.config.init)
                liberator.config.init();

            liberator.log("All modules loaded", 3);

            // TODO: move elsewhere
            liberator.registerCallback("submit", liberator.modes.EX, function (command) { liberator.execute(command); });
            liberator.registerCallback("complete", liberator.modes.EX, function (str) { return liberator.completion.ex(str); });

            // first time intro message
            if (liberator.options.getPref("extensions." + liberator.config.name.toLowerCase() + ".firsttime", true))
            {
                setTimeout(function () {
                    liberator.help();
                    liberator.options.setPref("extensions." + liberator.config.name.toLowerCase() + ".firsttime", false);
                }, 1000);
            }

            // always start in normal mode
            liberator.modes.reset();

            // TODO: we should have some class where all this guioptions stuff fits well
            hideGUI();

            // finally, read a ~/.vimperatorrc and plugin/**.{vimp,js}
            // make sourcing asynchronous, otherwise commands that open new tabs won't work
            setTimeout(function () {

                var rcFile = liberator.io.getRCFile();

                if (rcFile)
                    liberator.io.source(rcFile.path, true);
                else
                    liberator.log("No user RC file found", 3);

                if (liberator.options["loadplugins"])
                    liberator.loadPlugins;

                // after sourcing the initialization files, this function will set
                // all gui options to their default values, if they have not been
                // set before by any rc file
                for (let option in liberator.options)
                {
                    if (option.setter)
                        option.value = option.value;
                }

                liberator.triggerObserver("enter", null);
                liberator.autocommands.trigger(liberator.config.name + "Enter", {});
            }, 0);

            liberator.statusline.update();

            liberator.log(liberator.config.name + " fully initialized", 0);
        },

        shutdown: function ()
        {
            liberator.autocommands.trigger(liberator.config.name + "LeavePre", {});

            liberator.storage.saveAll();

            liberator.triggerObserver("shutdown", null);

            liberator.dump("All liberator modules destroyed\n");

            liberator.autocommands.trigger(liberator.config.name + "Leave", {});
        },

        sleep: function (ms)
        {
            var mainThread = threadManager.mainThread;

            var then = new Date().getTime(), now = then;
            for (; now - then < ms; now = new Date().getTime())
                mainThread.processNextEvent(true);
            return true;
        },

        threadYield: function (flush)
        {
            let mainThread = threadManager.mainThread;
            do
                mainThread.processNextEvent(true);
            while (flush && mainThread.hasPendingEvents());
        },

        get windows()
        {
            var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                               .getService(Components.interfaces.nsIWindowMediator);
            var wa = [];
            var enumerator = wm.getEnumerator("navigator:browser");
            while (enumerator.hasMoreElements())
                wa.push(enumerator.getNext());
            return wa;
        },

        // be sure to call GUI related methods like alert() or dump() ONLY in the main thread
        callFunctionInThread: function (thread, func, args)
        {
            function CallbackEvent(func, args)
            {
                if (!(args instanceof Array))
                    args = [];

                return {
                    QueryInterface: function (iid)
                    {
                        if (iid.equals(Components.interfaces.nsIRunnable) ||
                            iid.equals(Components.interfaces.nsISupports))
                            return this;
                        throw Components.results.NS_ERROR_NO_INTERFACE;
                    },

                    run: function ()
                    {
                        func.apply(window, args);
                    }
                };
            }

            if (!thread)
                thread = Components.classes["@mozilla.org/thread-manager;1"].getService().newThread(0);

            // DISPATCH_SYNC is necessary, otherwise strange things will happen
            thread.dispatch(new CallbackEvent(func, args), thread.DISPATCH_SYNC);
        }

    };
    //}}}
})(); //}}}

// called when the chrome is fully loaded and before the main window is shown
window.addEventListener("load",   liberator.startup,  false);
window.addEventListener("unload", liberator.shutdown, false);

// vim: set fdm=marker sw=4 ts=4 et:
