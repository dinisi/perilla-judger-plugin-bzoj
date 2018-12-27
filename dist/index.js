"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require("debug");
const fs_1 = require("fs");
const jsdom_1 = require("jsdom");
const path_1 = require("path");
const superagent_1 = require("superagent");
const interfaces_1 = require("./interfaces");
const MAX_SOURCE_SIZE = 16 * 1024 * 1024;
const UPDATE_INTERVAL = 1000;
const configPath = path_1.join(__dirname, "..", "config.json");
const config = JSON.parse(fs_1.readFileSync(configPath).toString());
const agent = superagent_1.agent();
const log = debug("perilla:judger:plugin:bzoj");
const isLoggedIn = async () => {
    const result = await agent.get("https://www.lydsy.com/JudgeOnline/modifypage.php");
    return result.status === 200 && !/Please LogIn First!/.test(result.text);
};
const initRequest = async () => {
    log("Login");
    await agent
        .post("https://www.lydsy.com/JudgeOnline/login.php")
        .send({ user_id: config.username, password: config.password, submit: "Submit" })
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Referer", "https://www.lydsy.com/JudgeOnline/loginpage.php")
        .redirects(2);
    if (!await isLoggedIn()) {
        throw new Error("Login failed");
    }
    log("Done");
};
const submit = async (id, source, language) => {
    if (language === null) {
        throw new Error("Language Rejected");
    }
    const result = await agent
        .post("https://www.lydsy.com/JudgeOnline/submit.php")
        .send({ id, language, source })
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Referer", `https://www.lydsy.com/JudgeOnline/submitpage.php?id=${id}`)
        .redirects(2);
    const dom = new jsdom_1.JSDOM(result.text);
    const resultTable = dom.window.document.querySelector('table[align="center"]');
    const resultRows = resultTable.querySelectorAll('tr[align="center"]');
    for (const resultRow of resultRows) {
        if (resultRow.childNodes[1].textContent !== config.username) {
            continue;
        }
        return parseInt(resultRow.childNodes[0].textContent, 10);
    }
    throw new Error("Submit failed");
};
const updateMap = new Map();
const convertStatus = (status) => {
    switch (status) {
        case "Pending":
        case "Pending_Rejudging":
            return interfaces_1.SolutionResult.WaitingJudge;
        case "Compiling":
        case "Running_&_Judging":
            return interfaces_1.SolutionResult.Judging;
        case "Accepted":
            return interfaces_1.SolutionResult.Accepted;
        case "Presentation_Error":
            return interfaces_1.SolutionResult.PresentationError;
        case "Time_Limit_Exceed":
            return interfaces_1.SolutionResult.TimeLimitExceeded;
        case "Memory_Limit_Exceed":
            return interfaces_1.SolutionResult.MemoryLimitExceeded;
        case "Wrong_Answer":
        case "Output_Limit_Exceed":
            return interfaces_1.SolutionResult.WrongAnswer;
        case "Runtime_Error":
            return interfaces_1.SolutionResult.RuntimeError;
        case "Compile_Error":
            return interfaces_1.SolutionResult.CompileError;
    }
    return interfaces_1.SolutionResult.OtherError;
};
const fetch = async (runID) => {
    const url = `https://www.lydsy.com/JudgeOnline/status.php?&top=${runID}`;
    const result = await agent.get(url);
    const dom = new jsdom_1.JSDOM(result.text);
    const resultTable = dom.window.document.querySelector('table[align="center"]');
    const resultRow = resultTable.querySelector('tr[align="center"]');
    const status = convertStatus(resultRow.childNodes[3].textContent.trim());
    const score = status === interfaces_1.SolutionResult.Accepted ? 100 : 0;
    return {
        result: {
            details: {
                runID: resultRow.childNodes[0].textContent,
                remoteUser: resultRow.childNodes[1].textContent,
                submitTime: resultRow.childNodes[8].textContent,
            },
            memory: resultRow.childNodes[4].textContent,
            time: resultRow.childNodes[5].textContent,
        },
        status,
        score,
    };
};
const updateSolutionResults = async () => {
    for (const [runid, cb] of updateMap) {
        try {
            const result = await fetch(runid);
            cb(result);
            if (result.status !== interfaces_1.SolutionResult.Judging && result.status !== interfaces_1.SolutionResult.WaitingJudge) {
                updateMap.delete(runid);
            }
        }
        catch (e) {
            cb({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: e.message, runID: runid } });
        }
    }
    setTimeout(updateSolutionResults, UPDATE_INTERVAL);
};
const main = async (problem, solution, resolve, update) => {
    if (interfaces_1.Problem.guard(problem)) {
        if (interfaces_1.Solution.guard(solution)) {
            if (!await isLoggedIn()) {
                try {
                    await initRequest();
                }
                catch (e) {
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: e.message } });
                }
            }
            try {
                let langcode = null;
                if (solution.language === "c") {
                    langcode = 0;
                }
                else if (solution.language === "cpp98") {
                    langcode = 1;
                }
                else if (solution.language === "pascal") {
                    langcode = 2;
                }
                else if (solution.language === "java") {
                    langcode = 3;
                }
                else if (solution.language === "python2") {
                    langcode = 6;
                }
                if (langcode === null) {
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Language rejected" } });
                }
                const source = await resolve(solution.file);
                const stat = fs_1.statSync(source.path);
                if (stat.size > MAX_SOURCE_SIZE) {
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "File is too big" } });
                }
                const content = fs_1.readFileSync(source.path).toString();
                const runID = await submit(problem.id, content, langcode);
                updateMap.set(runID, update);
            }
            catch (e) {
                return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid solution" } });
            }
        }
        else {
            return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid solution" } });
        }
    }
    else {
        return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid problem" } });
    }
};
module.exports = main;
updateSolutionResults();
//# sourceMappingURL=index.js.map