import debug = require("debug");
import { readFileSync, statSync } from "fs";
import { JSDOM } from "jsdom";
import { join } from "path";
import { agent as createAgent } from "superagent";
import { ISolution, JudgeFunction, Problem, Solution, SolutionResult } from "./interfaces";

const MAX_SOURCE_SIZE = 16 * 1024 * 1024;
const UPDATE_INTERVAL = 2000;

const configPath = join(__dirname, "..", "config.json");
const config = JSON.parse(readFileSync(configPath).toString());

const agent = createAgent();
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
    if (!await isLoggedIn()) { throw new Error("Login failed"); }
    // tslint:disable-next-line:no-console
    log("Done");
};

const submit = async (id: number, source: string, language: number) => {
    if (language === null) { throw new Error("Language Rejected"); }
    const result = await agent
        .post("https://www.lydsy.com/JudgeOnline/submit.php")
        .send({ id, language, source })
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Referer", `https://www.lydsy.com/JudgeOnline/submitpage.php?id=${id}`)
        .redirects(2);
    const dom = new JSDOM(result.text);
    const resultTable = dom.window.document.querySelector('table[align="center"]');
    const resultRows = resultTable.querySelectorAll('tr[align="center"]');
    for (const resultRow of resultRows) {
        if (resultRow.childNodes[1].textContent !== config.username) { continue; }
        return parseInt(resultRow.childNodes[0].textContent, 10);
    }
    throw new Error("Submit failed");
};
const updateMap = new Map<number, (solution: ISolution) => Promise<void>>();

const convertStatus = (status: string) => {
    switch (status) {
        case "Pending":
        case "Pending_Rejudging":
            return SolutionResult.WaitingJudge;
        case "Compiling":
        case "Running_&_Judging":
            return SolutionResult.Judging;
        case "Accepted":
            return SolutionResult.Accepted;
        case "Presentation_Error":
            return SolutionResult.PresentationError;
        case "Time_Limit_Exceed":
            return SolutionResult.TimeLimitExceeded;
        case "Memory_Limit_Exceed":
            return SolutionResult.MemoryLimitExceeded;
        case "Wrong_Answer":
        case "Output_Limit_Exceed":
            return SolutionResult.WrongAnswer;
        case "Runtime_Error":
            return SolutionResult.RuntimeError;
        case "Compile_Error":
            return SolutionResult.CompileError;
    }
    return SolutionResult.OtherError;
};

const fetch = async (runID: number) => {
    const url = `https://www.lydsy.com/JudgeOnline/status.php?&top=${runID}`;
    const result = await agent.get(url);
    const dom = new JSDOM(result.text);
    const resultTable = dom.window.document.querySelector('table[align="center"]');
    const resultRow = resultTable.querySelector('tr[align="center"]');
    const status = convertStatus(resultRow.childNodes[3].textContent.trim());
    const score = status === SolutionResult.Accepted ? 100 : 0;
    return {
        details: {
            runID,
            remoteUser: resultRow.childNodes[1].textContent,
            submitTime: resultRow.childNodes[8].textContent,
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
            if (result.status !== SolutionResult.Judging && result.status !== SolutionResult.WaitingJudge) {
                updateMap.delete(runid);
            }
        } catch (e) {
            cb({ status: SolutionResult.JudgementFailed, score: 0, details: { error: e.message, runID: runid } });
        }
    }
    setTimeout(updateSolutionResults, UPDATE_INTERVAL);
};

const main: JudgeFunction = async (problem, solution, resolve, update) => {
    if (Problem.guard(problem)) {
        if (Solution.guard(solution)) {
            if (!await isLoggedIn()) {
                try {
                    await initRequest();
                } catch (e) {
                    return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: e.message } });
                }
            }
            try {
                let langcode = null;
                if (solution.language === "c") {
                    langcode = 0;
                } else if (solution.language === "cpp98") {
                    langcode = 1;
                } else if (solution.language === "pascal") {
                    langcode = 2;
                } else if (solution.language === "java") {
                    langcode = 3;
                }
                // } else if (solution.language === "python2") {
                //     langcode = 6;
                // }
                if (langcode === null) {
                    return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "Language rejected" } });
                }
                const source = await resolve(solution.file);
                const stat = statSync(source.path);
                if (stat.size > MAX_SOURCE_SIZE) {
                    return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "File is too big" } });
                }
                const content = readFileSync(source.path).toString();
                const runID = await submit(problem.id, content, langcode);
                updateMap.set(runID, update);
            } catch (e) {
                return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid solution" } });
            }
        } else {
            return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid solution" } });
        }
    } else {
        return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid problem" } });
    }
};

module.exports = main;

updateSolutionResults();
