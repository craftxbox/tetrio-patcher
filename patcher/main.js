const asar = require('asar');
const npm = require("npm")
const { join } = require('path');
const diff = require('diff');
const fs = require('fs');
const { app } = require('electron');
const hashfile = require("sha256-file")
const MergeTrees = require("merge-trees")
const Module = require("module");

const appInjectedPath = join(__dirname,"app-injected");
const patchesPath = join(__dirname,"patches");

var patchesToApply = fs.existsSync(patchesPath) ? fs.readdirSync(patchesPath) : false
var appliedPatches = fs.existsSync(join(__dirname, "applied-patches.json")) ? require(join(__dirname, "applied-patches.json")) : {}
var patchesNeedApplying = false;

app.setPath('userData', join(app.getPath('userData'), "..", "tetrio-desktop")) // Otherwise the game will not load existing user data

//unpack the client
function unpackClient(refresh = false) {

	if (refresh) {
		if (fs.existsSync(appInjectedPath))
			fs.rmdirSync(appInjectedPath, { recursive: true })
		if (fs.existsSync(join(__dirname, "index.html")))
			fs.unlinkSync(join(__dirname, "index.html"))
		if (fs.existsSync(join(__dirname, "assets")))
			fs.unlinkSync(join(__dirname, "assets"))
	}

	if (refresh || !fs.existsSync(appInjectedPath)) {
		asar.extractAll(join(__dirname, "..", "app.asar"), appInjectedPath)
	}

	//symlink to avoid having to patch the game for our own installation
	if (!fs.existsSync(join(__dirname, "index.html")))
		fs.linkSync(join(appInjectedPath, "index.html"), join(__dirname, "index.html"), "file")
	if (!fs.existsSync(join(__dirname, "assets")))
		fs.symlinkSync(join(appInjectedPath, "assets"), join(__dirname, "assets"), "junction")
}

// create the patches dir if it doesnt exist
if (!patchesToApply) {
	fs.mkdirSync(patchesPath)
	patchesToApply = [];
}

//check if patches need applying
for (var i of patchesToApply) {
	if (!i.endsWith(".patch")) continue // not a patch file
	var patchHash = hashfile(join(patchesPath, i))
	var file = i.replace(/.patch$/, "")
	if (!appliedPatches[file] || appliedPatches[file] != patchHash) {
		patchesNeedApplying = true;
		unpackClient(true)
		break;
	}
}

if (!patchesNeedApplying) unpackClient();

// apply patches
if (patchesNeedApplying) {
	fs.renameSync(join(appInjectedPath,"package.json"),join(appInjectedPath,"package.json.original"))
	fs.linkSync(join(patchesPath,"package.json"),join(appInjectedPath,"package.json"))
	var originalDir = process.cwd();
	process.chdir(appInjectedPath);
	npm.load({"package-lock":false}, () => {
		npm.commands.install([appInjectedPath], (er, data) => {
			process.chdir(originalDir)
			fs.unlinkSync(join(appInjectedPath,"package.json"))
			fs.renameSync(join(appInjectedPath,"package.json.original"),join(appInjectedPath,"package.json"))
			if (!er) {
				for (var i of patchesToApply) {
					if (!i.endsWith(".patch")) continue; //not a patch file
					var file = i.replace(/.patch$/, "")
					var patchHash = hashfile(join(patchesPath, i))
					if (appliedPatches[file] && appliedPatches[file] == patchHash) continue //patch already applied?
					appliedPatches[file] = patchHash;
					var source = fs.readFileSync(join(appInjectedPath, file), { encoding: "utf-8" })
					var patch = fs.readFileSync(join(patchesPath, i), { encoding: "utf-8" })
					var patched = diff.applyPatch(source, patch)
					fs.writeFileSync(join(appInjectedPath, file), patched)
				}
				finalizeLaunch();
			} else {
				throw er
			}
		})
	})
} else {
	finalizeLaunch();
}

function finalizeLaunch() {
	// save applied patches
	fs.writeFileSync(join(__dirname, "applied-patches.json"), JSON.stringify(appliedPatches))

	Module._load(join(appInjectedPath, "main.js"), null, true) // load the game :)
}