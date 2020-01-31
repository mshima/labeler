"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const yaml = __importStar(require("js-yaml"));
const minimatch_1 = require("minimatch");
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const token = core.getInput('repo-token', { required: true });
            const configPath = core.getInput('configuration-path', { required: true });
            const notFoundLabel = core.getInput('not-found-label');
            const operationsPerRun = parseInt(core.getInput('operations-per-run', { required: true }));
            let operationsLeft = operationsPerRun;
            const client = new github.GitHub(token);
            const prNumber = getPrNumber();
            if (prNumber) {
                yield processPR(client, prNumber, configPath, notFoundLabel);
                return;
            }
            const opts = yield client.pulls.list.endpoint.merge({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                state: 'open',
                sort: 'updated'
            });
            let prs = yield client.paginate(opts);
            prs = prs.filter(pr => {
                const hasLabels = pr.labels && pr.labels.length > 0;
                if (hasLabels) {
                    core.debug(`pr ${pr.number} already has ${pr.labels.length} labels`);
                }
                return !hasLabels;
            });
            for (const pr of prs) {
                core.debug(`performing labeler at pr ${pr.number}`);
                if (operationsLeft <= 0) {
                    core.warning(`performed ${operationsPerRun} operations, exiting to avoid rate limit`);
                    return;
                }
                if (yield processPR(client, pr.number, configPath, notFoundLabel)) {
                    operationsLeft -= 1;
                }
            }
            ;
        }
        catch (error) {
            core.error(error);
            core.setFailed(error.message);
        }
    });
}
function processPR(client, prNumber, configPath, notFoundLabel) {
    return __awaiter(this, void 0, void 0, function* () {
        core.debug(`fetching changed files for pr #${prNumber}`);
        const changedFiles = yield getChangedFiles(client, prNumber);
        const labelGlobs = yield getLabelGlobs(client, configPath);
        const labels = [];
        for (const [label, globs] of labelGlobs.entries()) {
            core.debug(`processing ${label}`);
            if (checkGlobs(changedFiles, globs)) {
                labels.push(label);
            }
        }
        if (notFoundLabel && labels.length === 0) {
            labels.push(notFoundLabel);
        }
        if (labels.length > 0) {
            yield addLabels(client, prNumber, labels);
            return true;
        }
        return false;
    });
}
function getPrNumber() {
    const pullRequest = github.context.payload.pull_request;
    if (!pullRequest) {
        return undefined;
    }
    return pullRequest.number;
}
function getChangedFiles(client, prNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        const listFilesResponse = yield client.pulls.listFiles({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: prNumber
        });
        const changedFiles = listFilesResponse.data.map(f => f.filename);
        core.debug('found changed files:');
        for (const file of changedFiles) {
            core.debug('  ' + file);
        }
        return changedFiles;
    });
}
function getLabelGlobs(client, configurationPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const configurationContent = yield fetchContent(client, configurationPath);
        // loads (hopefully) a `{[label:string]: string | string[]}`, but is `any`:
        const configObject = yaml.safeLoad(configurationContent);
        // transform `any` => `Map<string,string[]>` or throw if yaml is malformed:
        return getLabelGlobMapFromObject(configObject);
    });
}
function fetchContent(client, repoPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield client.repos.getContents({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            path: repoPath,
            ref: github.context.sha
        });
        return Buffer.from(response.data.content, 'base64').toString();
    });
}
function getLabelGlobMapFromObject(configObject) {
    const labelGlobs = new Map();
    for (const label in configObject) {
        if (typeof configObject[label] === 'string') {
            labelGlobs.set(label, [configObject[label]]);
        }
        else if (configObject[label] instanceof Array) {
            labelGlobs.set(label, configObject[label]);
        }
        else {
            throw Error(`found unexpected type for label ${label} (should be string or array of globs)`);
        }
    }
    return labelGlobs;
}
function checkGlobs(changedFiles, globs) {
    for (const glob of globs) {
        core.debug(` checking pattern ${glob}`);
        const matcher = new minimatch_1.Minimatch(glob);
        for (const changedFile of changedFiles) {
            core.debug(` - ${changedFile}`);
            if (matcher.match(changedFile)) {
                core.debug(` ${changedFile} matches`);
                return true;
            }
        }
    }
    return false;
}
function addLabels(client, prNumber, labels) {
    return __awaiter(this, void 0, void 0, function* () {
        yield client.issues.addLabels({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: prNumber,
            labels: labels
        });
    });
}
run();
