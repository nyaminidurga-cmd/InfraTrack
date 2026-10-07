
/* =========================================================
   INFRATRACK
   New Project Management Flow
========================================================= */


/* =========================================================
   STORAGE (Supabase)
========================================================= */

let projects = [];

let currentProjectId = null;

let selectedYearIndex = null;

let appLoading = false;

let appError = null;

let supabaseClient = null;


function sameId(left, right) {

    return String(left) === String(right);

}


function isSupabaseConfigured() {

    const config = window.INFRA_TRACK_SUPABASE || {};

    const url = (config.url || "").trim();

    const anonKey = (config.anonKey || "").trim();

    return (
        url.indexOf("https://") === 0 &&
        anonKey.length > 20 &&
        url.indexOf("YOUR_SUPABASE") === -1 &&
        anonKey.indexOf("YOUR_SUPABASE") === -1
    );

}


function getSupabase() {

    if (supabaseClient) {
        return supabaseClient;
    }

    if (!window.supabase || !window.supabase.createClient) {
        throw new Error("The Supabase library failed to load.");
    }

    if (!isSupabaseConfigured()) {
        throw new Error(
            "Add your Supabase URL and anon key in config.js."
        );
    }

    supabaseClient = window.supabase.createClient(
        window.INFRA_TRACK_SUPABASE.url.trim(),
        window.INFRA_TRACK_SUPABASE.anonKey.trim()
    );

    return supabaseClient;

}


function errorMessage(error) {

    if (!error) {
        return "Something went wrong.";
    }

    if (typeof error === "string") {
        return error;
    }

    return error.message || "Something went wrong.";

}


function monthToDbDate(monthString) {

    if (!monthString) {
        return null;
    }

    if (monthString.length === 7) {
        return monthString + "-01";
    }

    return String(monthString).slice(0, 10);

}


function monthFromDbDate(value) {

    if (!value) {
        return "";
    }

    return String(value).slice(0, 7);

}


function mapDbProject(row) {

    const years = (row.project_years || [])
        .slice()
        .sort(function(a, b) {
            return Number(a.year_index) - Number(b.year_index);
        })
        .map(function(year) {

            const updates = (year.progress_updates || [])
                .slice()
                .sort(function(a, b) {
                    return String(a.month).localeCompare(String(b.month));
                })
                .map(function(update) {
                    return {
                        id: update.id,
                        month: monthFromDbDate(update.month),
                        monthlyWork: Number(update.monthly_work),
                        monthlyExpenditure: Number(update.monthly_expenditure),
                        savedAt: update.saved_at
                    };
                });

            return {
                id: year.id,
                label: year.label,
                startYear: year.start_year,
                yearStart: year.year_start,
                yearEnd: year.year_end,
                plannedWork: Number(year.planned_work),
                plannedExpenditure: Number(year.planned_expenditure),
                progressUpdates: updates
            };

        });

    return {
        id: row.id,
        name: row.name,
        type: row.type,
        location: row.location,
        totalBudget: Number(row.total_budget),
        startDate: row.start_date,
        endDate: row.end_date,
        description: row.description || "",
        createdAt: row.created_at,
        years: years
    };

}


async function loadProjectsFromDatabase() {

    appLoading = true;
    appError = null;

    const { data, error } = await getSupabase()
        .from("projects")
        .select(`
            id,
            name,
            type,
            location,
            total_budget,
            start_date,
            end_date,
            description,
            created_at,
            project_years (
                id,
                year_index,
                label,
                start_year,
                year_start,
                year_end,
                planned_work,
                planned_expenditure,
                progress_updates (
                    id,
                    month,
                    monthly_work,
                    monthly_expenditure,
                    saved_at
                )
            )
        `)
        .order("created_at", { ascending: false });

    if (error) {
        throw error;
    }

    projects = (data || []).map(mapDbProject);

    appLoading = false;

}


async function refreshProjects() {

    const previousId = currentProjectId;

    await loadProjectsFromDatabase();

    if (
        previousId &&
        !projects.find(function(project) {
            return sameId(project.id, previousId);
        })
    ) {
        currentProjectId = null;
        selectedYearIndex = null;
    }

}


async function createProjectInDatabase(project) {

    const client = getSupabase();

    const { data: row, error } = await client
        .from("projects")
        .insert({
            name: project.name,
            type: project.type,
            location: project.location,
            total_budget: project.totalBudget,
            start_date: project.startDate,
            end_date: project.endDate,
            description: project.description || null
        })
        .select()
        .single();

    if (error) {
        throw error;
    }

    const yearRows = project.years.map(function(year, index) {
        return {
            project_id: row.id,
            year_index: index,
            label: year.label,
            start_year: year.startYear,
            year_start: year.yearStart,
            year_end: year.yearEnd,
            planned_work: year.plannedWork,
            planned_expenditure: year.plannedExpenditure
        };
    });

    const { error: yearError } = await client
        .from("project_years")
        .insert(yearRows);

    if (yearError) {
        await client.from("projects").delete().eq("id", row.id);
        throw yearError;
    }

    return row.id;

}


async function updateProjectDetailsInDatabase(projectId, details) {

    const { error } = await getSupabase()
        .from("projects")
        .update({
            name: details.name,
            type: details.type,
            location: details.location,
            description: details.description || null
        })
        .eq("id", projectId);

    if (error) {
        throw error;
    }

}


async function deleteProjectFromDatabase(projectId) {

    const { error } = await getSupabase()
        .from("projects")
        .delete()
        .eq("id", projectId);

    if (error) {
        throw error;
    }

}


async function saveMonthlyUpdateInDatabase(yearId, month, monthlyWork, monthlyExpenditure) {

    const { error } = await getSupabase()
        .from("progress_updates")
        .upsert(
            {
                project_year_id: yearId,
                month: monthToDbDate(month),
                monthly_work: monthlyWork,
                monthly_expenditure: monthlyExpenditure,
                saved_at: new Date().toISOString()
            },
            {
                onConflict: "project_year_id,month"
            }
        );

    if (error) {
        throw error;
    }

}


async function deleteMonthlyUpdateFromDatabase(yearId, month) {

    const { error } = await getSupabase()
        .from("progress_updates")
        .delete()
        .eq("project_year_id", yearId)
        .eq("month", monthToDbDate(month));

    if (error) {
        throw error;
    }

}


async function reloadFromDatabase() {

    try {

        await refreshProjects();

        renderProjectsList();
        renderDashboard();

    } catch (error) {

        appLoading = false;
        appError = errorMessage(error);

        renderProjectsList();
        renderDashboard();

        alert(appError);

    }

}


/* =========================================================
   BASIC HELPERS
========================================================= */

function formatDate(dateString) {

    if (!dateString) {
        return "-";
    }

    const date =
        new Date(dateString + "T00:00:00");


    return date.toLocaleDateString(
        "en-IN",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    );

}


function formatMonth(monthString) {

    if (!monthString) {
        return "-";
    }

    const [year, month] =
        monthString.split("-");


    const date =
        new Date(
            Number(year),
            Number(month) - 1,
            1
        );


    return date.toLocaleDateString(
        "en-IN",
        {
            month: "long",
            year: "numeric"
        }
    );

}


function getMonthKey(date) {

    return (
        date.getFullYear() +
        "-" +
        String(
            date.getMonth() + 1
        ).padStart(2, "0")
    );

}


function monthToDate(monthString) {

    if (!monthString) {
        return null;
    }

    const [year, month] =
        monthString.split("-");


    return new Date(
        Number(year),
        Number(month) - 1,
        1
    );

}


function formatAmount(value) {

    const number =
        Number(value) || 0;


    return (
        "₹ " +
        number.toFixed(2) +
        " Cr"
    );

}


function findProjectById(projectId) {

    return projects.find(function(project) {
        return sameId(project.id, projectId);
    });

}


/* =========================================================
   PAGE NAVIGATION
========================================================= */

function showPage(
    pageId,
    clickedButton = null
) {

    document
        .querySelectorAll(".page")
        .forEach(page => {

            page.classList.remove(
                "active-page"
            );

        });


    const page =
        document.getElementById(
            pageId
        );


    if (!page) {
        return;
    }


    page.classList.add(
        "active-page"
    );


    document
        .querySelectorAll(".nav-item")
        .forEach(button => {

            button.classList.remove(
                "active"
            );

        });


    if (clickedButton) {

        clickedButton.classList.add(
            "active"
        );

    } else {

        const matchingButton =
            document.querySelector(
                `.nav-item[onclick*="'${pageId}'"]`
            );


        if (matchingButton) {

            matchingButton.classList.add(
                "active"
            );

        }

    }


    if (
        pageId === "dashboardPage"
    ) {

        renderDashboard();

    }


    if (
        pageId === "projectsPage"
    ) {

        renderProjectsList();

    }


    if (
        pageId === "createPage"
    ) {

        prepareCreatePage();

    }


    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

}


/* =========================================================
   PROJECT YEARS
========================================================= */

function generateProjectYears(
    startDate,
    endDate
) {

    const start =
        new Date(
            startDate + "T00:00:00"
        );


    const end =
        new Date(
            endDate + "T00:00:00"
        );


    const years = [];


    let year =
        start.getFullYear();


    const finalYear =
        end.getFullYear();


    while (
        year <= finalYear
    ) {

        const yearStart =
            year === start.getFullYear()
                ? startDate
                : `${year}-01-01`;


        const yearEnd =
            year === finalYear
                ? endDate
                : `${year}-12-31`;


        years.push({

            label:
                `${year}-${String(
                    year + 1
                ).slice(-2)}`,

            startYear:
                year,

            yearStart,

            yearEnd,

            plannedWork: "",

            plannedExpenditure: "",

            progressUpdates: []

        });


        year++;

    }


    return years;

}


/* =========================================================
   CREATE PROJECT - DATE CHANGE
========================================================= */

document
    .getElementById("startDate")
    .addEventListener(
        "change",
        preparePlanning
    );


document
    .getElementById("endDate")
    .addEventListener(
        "change",
        preparePlanning
    );


async function preparePlanning() {

    const startDate =
        document.getElementById(
            "startDate"
        ).value;


    const endDate =
        document.getElementById(
            "endDate"
        ).value;


    const planningSection =
        document.getElementById(
            "planningSection"
        );


    const actions =
        document.getElementById(
            "createActions"
        );


    if (
        !startDate ||
        !endDate
    ) {

        planningSection.classList.add(
            "hidden"
        );

        actions.classList.add(
            "hidden"
        );

        return;

    }


    if (
        new Date(endDate) <=
        new Date(startDate)
    ) {

        planningSection.classList.add(
            "hidden"
        );

        actions.classList.add(
            "hidden"
        );

        return;

    }


    const years =
        generateProjectYears(
            startDate,
            endDate
        );


    renderCreatePlanningTable(
        years
    );


    planningSection.classList.remove(
        "hidden"
    );


    actions.classList.remove(
        "hidden"
    );

}


/* =========================================================
   CREATE PLANNING TABLE
========================================================= */

function renderCreatePlanningTable(
    years
) {

    const container =
        document.getElementById(
            "createPlanningTable"
        );


    const yearCount =
        document.getElementById(
            "createYearCount"
        );


    yearCount.textContent =
        `${years.length} ${
            years.length === 1
                ? "Year"
                : "Years"
        }`;


    let html = `

        <table class="create-planning-table">

            <thead>

                <tr>

                    <th>
                        Project Year
                    </th>

                    <th>
                        Planned Work (%)
                    </th>

                    <th>
                        Planned Expenditure (₹ Cr)
                    </th>

                </tr>

            </thead>

            <tbody>

    `;


    years.forEach(
        (year, index) => {

            html += `

                <tr>

                    <td>
                        <strong>
                            ${year.label}
                        </strong>
                    </td>

                    <td>

                        <input
                            type="number"
                            class="create-work"
                            data-index="${index}"
                            min="0"
                            max="100"
                            step="0.01"
                            placeholder="e.g. 25"
                        >

                    </td>

                    <td>

                        <input
                            type="number"
                            class="create-expenditure"
                            data-index="${index}"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 500"
                        >

                    </td>

                </tr>

            `;

        }
    );


    html += `

            </tbody>

        </table>

    `;


    container.innerHTML =
        html;


    document
        .querySelectorAll(
            ".create-expenditure"
        )
        .forEach(input => {

            input.addEventListener(
                "input",
                updateCreateBudgetSummary
            );

        });


    updateCreateBudgetSummary();

}


/* =========================================================
   CREATE BUDGET SUMMARY
========================================================= */

function updateCreateBudgetSummary() {

    const totalBudget =
        Number(
            document
                .getElementById(
                    "totalBudget"
                )
                .value
        ) || 0;


    let yearlyTotal = 0;


    document
        .querySelectorAll(
            ".create-expenditure"
        )
        .forEach(input => {

            yearlyTotal +=
                Number(
                    input.value
                ) || 0;

        });


    const remaining =
        totalBudget -
        yearlyTotal;


    document
        .getElementById(
            "createTotalBudget"
        )
        .textContent =
        formatAmount(
            totalBudget
        );


    document
        .getElementById(
            "createYearlyBudget"
        )
        .textContent =
        formatAmount(
            yearlyTotal
        );


    document
        .getElementById(
            "createRemainingBudget"
        )
        .textContent =
        formatAmount(
            Math.max(
                remaining,
                0
            )
        );

}


/* =========================================================
   TOTAL BUDGET INPUT
========================================================= */

document
    .getElementById(
        "totalBudget"
    )
    .addEventListener(
        "input",
        updateCreateBudgetSummary
    );


/* =========================================================
   CREATE PROJECT
========================================================= */

document
    .getElementById(
        "projectForm"
    )
    .addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            const name =
                document
                    .getElementById(
                        "projectName"
                    )
                    .value
                    .trim();


            const type =
                document
                    .getElementById(
                        "projectType"
                    )
                    .value;


            const location =
                document
                    .getElementById(
                        "projectLocation"
                    )
                    .value
                    .trim();


            const totalBudget =
                Number(
                    document
                        .getElementById(
                            "totalBudget"
                        )
                        .value
                );


            const startDate =
                document
                    .getElementById(
                        "startDate"
                    )
                    .value;


            const endDate =
                document
                    .getElementById(
                        "endDate"
                    )
                    .value;


            const description =
                document
                    .getElementById(
                        "projectDescription"
                    )
                    .value
                    .trim();


            /* ---------------------------------------------
               BASIC VALIDATION
            --------------------------------------------- */

            if (!name) {

                alert(
                    "Please enter the project name."
                );

                return;

            }


            if (!type) {

                alert(
                    "Please select the project type."
                );

                return;

            }


            if (!location) {

                alert(
                    "Please enter the project location."
                );

                return;

            }


            if (
                !totalBudget ||
                totalBudget <= 0
            ) {

                alert(
                    "Please enter a valid total planned budget."
                );

                return;

            }


            if (
                !startDate ||
                !endDate
            ) {

                alert(
                    "Please select the project dates."
                );

                return;

            }


            if (
                new Date(endDate) <=
                new Date(startDate)
            ) {

                alert(
                    "End date must be after the start date."
                );

                return;

            }


            /* ---------------------------------------------
               GENERATE YEARS
            --------------------------------------------- */

            const years =
                generateProjectYears(
                    startDate,
                    endDate
                );


            /* ---------------------------------------------
               READ YEARLY PLAN
            --------------------------------------------- */

            const workInputs =
                document.querySelectorAll(
                    ".create-work"
                );


            const expenditureInputs =
                document.querySelectorAll(
                    ".create-expenditure"
                );


            let yearlyExpenditure =
                0;


            let previousWork = 0;


            for (
                let i = 0;
                i < years.length;
                i++
            ) {

                const work =
                    Number(
                        workInputs[i].value
                    );


                const expenditure =
                    Number(
                        expenditureInputs[i].value
                    );


                if (
                    isNaN(work) ||
                    work < 0 ||
                    work > 100
                ) {

                    alert(
                        `Please enter valid planned work for ${years[i].label}.`
                    );

                    return;

                }


                if (
                    isNaN(expenditure) ||
                    expenditure < 0
                ) {

                    alert(
                        `Please enter valid planned expenditure for ${years[i].label}.`
                    );

                    return;

                }


                if (
                    i > 0 &&
                    work < previousWork
                ) {

                    alert(
                        `Planned work for ${years[i].label} cannot be lower than the previous year.`
                    );

                    return;

                }


                years[i].plannedWork =
                    work;


                years[i].plannedExpenditure =
                    expenditure;


                yearlyExpenditure +=
                    expenditure;


                previousWork =
                    work;

            }


            /* ---------------------------------------------
               FINAL WORK = 100
            --------------------------------------------- */

            if (
                Number(
                    years[
                        years.length - 1
                    ].plannedWork
                ) !== 100
            ) {

                alert(
                    "The planned work for the final project year must be 100%."
                );

                return;

            }


            /* ---------------------------------------------
               BUDGET MUST MATCH
            --------------------------------------------- */

            if (
                Math.abs(
                    yearlyExpenditure -
                    totalBudget
                ) > 0.01
            ) {

                alert(

                    "Year-wise planned expenditure must equal the total planned budget.\n\n" +

                    "Total Planned Budget: " +
                    formatAmount(
                        totalBudget
                    ) +

                    "\nYear-wise Planned Expenditure: " +
                    formatAmount(
                        yearlyExpenditure
                    )

                );

                return;

            }


            /* ---------------------------------------------
               CREATE PROJECT
            --------------------------------------------- */

            const project = {

                name,

                type,

                location,

                totalBudget,

                startDate,

                endDate,

                description,

                years

            };


            const submitButton =
                event.target.querySelector(
                    'button[type="submit"]'
                );

            if (submitButton) {
                submitButton.disabled = true;
            }

            showToast("Saving project...");

            try {

                const newId =
                    await createProjectInDatabase(
                        project
                    );

                await refreshProjects();

                document
                    .getElementById(
                        "createdProjectName"
                    )
                    .textContent =
                    project.name;


                document
                    .getElementById(
                        "createdProjectBox"
                    )
                    .classList.remove(
                        "hidden"
                    );


                document
                    .getElementById(
                        "viewCreatedProject"
                    )
                    .onclick =
                    function() {

                        openProject(
                            newId
                        );

                    };


                showToast(
                    "Project created successfully."
                );

            } catch (error) {

                alert(
                    "The project could not be saved.\n\n" +
                    errorMessage(error)
                );

            } finally {

                if (submitButton) {
                    submitButton.disabled = false;
                }

            }

        }
    );


/* =========================================================
   RESET CREATE FORM
========================================================= */

function resetCreateForm() {

    document
        .getElementById(
            "projectForm"
        )
        .reset();


    document
        .getElementById(
            "planningSection"
        )
        .classList.add(
            "hidden"
        );


    document
        .getElementById(
            "createActions"
        )
        .classList.add(
            "hidden"
        );


    document
        .getElementById(
            "createdProjectBox"
        )
        .classList.add(
            "hidden"
        );


    document
        .getElementById(
            "createPlanningTable"
        )
        .innerHTML =
        "";


    updateCreateBudgetSummary();

}


/* =========================================================
   PREPARE CREATE PAGE
========================================================= */

function prepareCreatePage() {

    /*
       We don't clear the form automatically because
       the user may return to the Create Project page.

       The page only starts empty when no project is
       currently being created.
    */

}


/* =========================================================
   PROJECT LIST
========================================================= */

function renderProjectsList() {

    const container =
        document.getElementById(
            "projectsList"
        );


    if (!container) {
        return;
    }


    container.innerHTML = "";


    if (appLoading) {

        container.innerHTML = `

            <div class="empty-dashboard">

                <h3>
                    Loading projects
                </h3>

                <p>
                    Fetching your infrastructure projects
                    from the database.
                </p>

            </div>

        `;

        return;

    }


    if (appError) {

        container.innerHTML = `

            <div class="empty-dashboard">

                <h3>
                    Could not load projects
                </h3>

                <p>
                    ${escapeHTML(appError)}
                </p>

                <button
                    class="primary-btn"
                    onclick="reloadFromDatabase()"
                >
                    Retry
                </button>

            </div>

        `;

        return;

    }


    /*
       If there are NO projects created by the user,
       the list remains empty.
    */

    if (
        projects.length === 0
    ) {

        container.innerHTML = `

            <div class="empty-dashboard">

                <div class="empty-icon-large">
                    +
                </div>

                <h3>
                    No projects created
                </h3>

                <p>
                    Your created infrastructure projects
                    will appear here.
                </p>

                <button
                    class="primary-btn"
                    onclick="showPage('createPage')"
                >
                    + Create Project
                </button>

            </div>

        `;

        return;

    }


    /*
       ONLY projects loaded from Supabase that match
       the search and filters are displayed.
    */

    const filtered = getFilteredProjects();

    if (filtered.length === 0) {

        container.innerHTML = `

            <div class="empty-dashboard">

                <h3>
                    No matching projects
                </h3>

                <p>
                    Try a different search or clear the filters.
                </p>

                <button
                    class="secondary-btn"
                    onclick="clearProjectFilters()"
                >
                    Clear Filters
                </button>

            </div>

        `;

        return;

    }


    filtered.forEach(
        project => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "project-card";


            const latest =
                getProjectLatestUpdate(
                    project
                );


            const status =
                latest
                    ? calculateStatus(
                        latest.actualWork,
                        latest.target
                    )
                    : "Not Started";


            card.innerHTML = `

                <div class="project-card-top">

                    <div>

                        <span class="project-type">
                            ${escapeHTML(
                                project.type
                            )}
                        </span>

                        <h3>
                            ${escapeHTML(
                                project.name
                            )}
                        </h3>

                        <p class="project-location">
                            ${escapeHTML(
                                project.location
                            )}
                        </p>

                    </div>


                    ${statusBadge(status)}

                </div>


                <div class="project-card-info">

                    <div>

                        <span>
                            Start Date
                        </span>

                        <strong>
                            ${formatDate(
                                project.startDate
                            )}
                        </strong>

                    </div>


                    <div>

                        <span>
                            End Date
                        </span>

                        <strong>
                            ${formatDate(
                                project.endDate
                            )}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Planned Budget
                        </span>

                        <strong>
                            ${formatAmount(
                                project.totalBudget
                            )}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Latest Progress
                        </span>

                        <strong>
                            ${
                                latest
                                    ? latest.actualWork.toFixed(2) + "%"
                                    : "Not Updated"
                            }
                        </strong>

                    </div>

                </div>


                <div class="project-card-footer">

                    <span>
                        ${project.years.length}
                        ${
                            project.years.length === 1
                                ? "project year"
                                : "project years"
                        }
                    </span>


                    <div class="card-actions">

                        <button
                            class="view-project-btn"
                            onclick="openProject('${project.id}')"
                        >
                            View Dashboard →
                        </button>

                        <button
                            class="view-project-btn"
                            onclick="openEditProject('${project.id}')"
                        >
                            Edit
                        </button>

                        <button
                            class="view-project-btn delete"
                            onclick="deleteProject('${project.id}')"
                        >
                            Delete
                        </button>

                    </div>

                </div>

            `;


            container.appendChild(
                card
            );

        }
    );

}


/* =========================================================
   OPEN PROJECT
========================================================= */

function openProject(
    projectId
) {

    const project =
        findProjectById(
            projectId
        );


    if (!project) {

        alert(
            "Project could not be found."
        );

        return;

    }


    currentProjectId =
        project.id;


    selectedYearIndex =
        null;


    renderDashboard();


    showPage(
        "dashboardPage"
    );

}


/* =========================================================
   GET CURRENT PROJECT
========================================================= */

function getCurrentProject() {

    return findProjectById(
        currentProjectId
    );

}


/* =========================================================
   RENDER DASHBOARD
========================================================= */

function renderDashboard() {

    const empty =
        document.getElementById(
            "emptyDashboard"
        );


    const dashboard =
        document.getElementById(
            "projectDashboard"
        );


    const project =
        getCurrentProject();


    if (appLoading && !project) {

        empty.classList.remove(
            "hidden"
        );

        dashboard.classList.add(
            "hidden"
        );

        document
            .getElementById(
                "dashboardTitle"
            )
            .textContent =
            "Dashboard";

        document
            .getElementById(
                "dashboardSubtitle"
            )
            .textContent =
            "Loading project data...";

        const emptyTitle =
            empty.querySelector("h3");

        const emptyText =
            empty.querySelector("p");

        if (emptyTitle) {
            emptyTitle.textContent =
                "Loading...";
        }

        if (emptyText) {
            emptyText.textContent =
                "Fetching projects from the database.";
        }

        return;

    }


    if (appError && !project) {

        empty.classList.remove(
            "hidden"
        );

        dashboard.classList.add(
            "hidden"
        );

        document
            .getElementById(
                "dashboardTitle"
            )
            .textContent =
            "Dashboard";

        document
            .getElementById(
                "dashboardSubtitle"
            )
            .textContent =
            "Could not load projects.";

        const emptyTitle =
            empty.querySelector("h3");

        const emptyText =
            empty.querySelector("p");

        if (emptyTitle) {
            emptyTitle.textContent =
                "Could not load projects";
        }

        if (emptyText) {
            emptyText.textContent =
                appError;
        }

        return;

    }


    /*
       No selected project
    */

    if (!project) {

        empty.classList.remove(
            "hidden"
        );

        dashboard.classList.add(
            "hidden"
        );

        document
            .getElementById(
                "dashboardTitle"
            )
            .textContent =
            "Dashboard";


        document
            .getElementById(
                "dashboardSubtitle"
            )
            .textContent =
            "Select a project to view its dashboard.";


        const emptyTitle =
            empty.querySelector("h3");

        const emptyText =
            empty.querySelector("p");

        if (emptyTitle) {
            emptyTitle.textContent =
                "No project selected";
        }

        if (emptyText) {
            emptyText.textContent =
                "Create a project first to view its infrastructure monitoring dashboard.";
        }


        return;

    }


    /*
       Project exists
    */

    empty.classList.add(
        "hidden"
    );


    dashboard.classList.remove(
        "hidden"
    );


    document
        .getElementById(
            "dashboardTitle"
        )
        .textContent =
        project.name;


    document
        .getElementById(
            "dashboardSubtitle"
        )
        .textContent =
        "Project dashboard";


    document
        .getElementById(
            "dashboardProjectName"
        )
        .textContent =
        project.name;


    document
        .getElementById(
            "dashboardProjectType"
        )
        .textContent =
        project.type;


    document
        .getElementById(
            "dashboardProjectLocation"
        )
        .textContent =
        project.location;


    document
        .getElementById(
            "dashboardStartDate"
        )
        .textContent =
        formatDate(
            project.startDate
        );


    document
        .getElementById(
            "dashboardEndDate"
        )
        .textContent =
        formatDate(
            project.endDate
        );


    document
        .getElementById(
            "dashboardBudget"
        )
        .textContent =
        formatAmount(
            project.totalBudget
        );


    document
        .getElementById(
            "dashboardDuration"
        )
        .textContent =
        `${project.years.length} ${
            project.years.length === 1
                ? "Year"
                : "Years"
        }`;


    const descriptionBox =
        document.getElementById(
            "dashboardDescriptionBox"
        );


    if (project.description) {

        descriptionBox.classList.remove(
            "hidden"
        );


        document
            .getElementById(
                "dashboardDescription"
            )
            .textContent =
            project.description;

    } else {

        descriptionBox.classList.add(
            "hidden"
        );

    }


    renderDashboardPlanning(
        project
    );


    renderYearButtons(
        project
    );


    renderLatestProgress(
        project
    );


    updateDashboardStatus(
        project
    );


    if (
        selectedYearIndex !== null
    ) {

        renderSelectedYear();

    } else {

        document
            .getElementById(
                "selectedYearArea"
            )
            .innerHTML = `

                <div class="empty-small">

                    Select a project year to view
                    monthly updates.

                </div>

            `;

    }

}


/* =========================================================
   DASHBOARD PLANNING
========================================================= */

function renderDashboardPlanning(
    project
) {

    const tbody =
        document.getElementById(
            "dashboardPlanningBody"
        );


    tbody.innerHTML = "";


    document
        .getElementById(
            "planningYearCount"
        )
        .textContent =
        `${project.years.length} Years`;


    project.years.forEach(
        year => {

            const row =
                document.createElement(
                    "tr"
                );


            row.innerHTML = `

                <td>
                    <strong>
                        ${year.label}
                    </strong>
                </td>

                <td>
                    ${Number(
                        year.plannedWork
                    ).toFixed(2)}%
                </td>

                <td>
                    ${formatAmount(
                        year.plannedExpenditure
                    )}
                </td>

            `;


            tbody.appendChild(
                row
            );

        }
    );

}


/* =========================================================
   YEAR BUTTONS
========================================================= */

function renderYearButtons(
    project
) {

    const container =
        document.getElementById(
            "yearButtons"
        );


    container.innerHTML = "";


    project.years.forEach(
        (year, index) => {

            const button =
                document.createElement(
                    "button"
                );


            button.className =
                "year-button";


            if (
                index ===
                selectedYearIndex
            ) {

                button.classList.add(
                    "active"
                );

            }


            button.textContent =
                year.label;


            button.onclick =
                function() {

                    selectYear(
                        index
                    );

                };


            container.appendChild(
                button
            );

        }
    );

}


/* =========================================================
   SELECT YEAR
========================================================= */

function selectYear(
    index
) {

    selectedYearIndex =
        index;


    renderYearButtons(
        getCurrentProject()
    );


    renderSelectedYear();

}


/* =========================================================
   SELECTED YEAR MONITORING
========================================================= */

function renderSelectedYear() {

    const project =
        getCurrentProject();


    if (!project) {
        return;
    }


    const year =
        project.years[
            selectedYearIndex
        ];


    if (!year) {
        return;
    }


    const cumulative =
        calculateCumulativeData(
            year
        );


    const latest =
        cumulative.length > 0
            ? cumulative[
                cumulative.length - 1
            ]
            : null;


    const actualWork =
        latest
            ? latest.cumulativeWork
            : 0;


    const actualExpenditure =
        latest
            ? latest.cumulativeExpenditure
            : 0;


    const target =
        Number(
            year.plannedWork
        );


    const status =
        latest
            ? calculateStatus(
                actualWork,
                target
            )
            : "Not Started";


    let html = `

        <div class="selected-year-header">

            <div>

                <p class="eyebrow">
                    SELECTED PROJECT YEAR
                </p>

                <h3>
                    ${year.label}
                </h3>

            </div>

            ${statusBadge(status)}

        </div>


        <div class="monitor-grid">

            <div class="monitor-item">

                <span>
                    Planned Work
                </span>

                <strong>
                    ${target.toFixed(2)}%
                </strong>

            </div>


            <div class="monitor-item">

                <span>
                    Latest Cumulative Work
                </span>

                <strong>
                    ${actualWork.toFixed(2)}%
                </strong>

            </div>


            <div class="monitor-item">

                <span>
                    Planned Expenditure
                </span>

                <strong>
                    ${formatAmount(
                        year.plannedExpenditure
                    )}
                </strong>

            </div>


            <div class="monitor-item">

                <span>
                    Cumulative Expenditure
                </span>

                <strong>
                    ${formatAmount(
                        actualExpenditure
                    )}
                </strong>

            </div>

        </div>


        <div>

            <span
                style="
                    font-size:11px;
                    color:#718096;
                "
            >
                Current Physical Progress
            </span>

            <strong
                style="
                    float:right;
                    font-size:11px;
                    color:#173f5f;
                "
            >
                ${actualWork.toFixed(2)}%
                /
                ${target.toFixed(2)}%
            </strong>

            <div class="progress-track">

                <div
                    class="progress-fill"
                    style="
                        width:${Math.min(
                            actualWork,
                            100
                        )}%;
                    "
                ></div>

            </div>

        </div>

    `;


    if (
        cumulative.length === 0
    ) {

        html += `

            <div class="empty-small">

                No monthly progress has been
                recorded for ${year.label}.

            </div>

        `;

    } else {

        html += `

            <div class="table-wrapper">

                <table class="data-table">

                    <thead>

                        <tr>

                            <th>
                                Month
                            </th>

                            <th>
                                Monthly Work
                            </th>

                            <th>
                                Cumulative Work
                            </th>

                            <th>
                                Monthly Expenditure
                            </th>

                            <th>
                                Cumulative Expenditure
                            </th>

                            <th>
                                Status
                            </th>

                            <th>
                                Actions
                            </th>

                        </tr>

                    </thead>

                    <tbody>

                        ${
                            cumulative
                                .map(
                                    update => {

                                        const st =
                                            calculateStatus(
                                                update.cumulativeWork,
                                                target
                                            );


                                        return `

                                            <tr>

                                                <td>
                                                    ${formatMonth(
                                                        update.month
                                                    )}
                                                </td>

                                                <td>
                                                    +${Number(
                                                        update.monthlyWork
                                                    ).toFixed(2)}%
                                                </td>

                                                <td>
                                                    ${Number(
                                                        update.cumulativeWork
                                                    ).toFixed(2)}%
                                                </td>

                                                <td>
                                                    ${formatAmount(
                                                        update.monthlyExpenditure
                                                    )}
                                                </td>

                                                <td>
                                                    ${formatAmount(
                                                        update.cumulativeExpenditure
                                                    )}
                                                </td>

                                                <td>
                                                    ${statusBadge(st)}
                                                </td>

                                                <td class="row-actions">

                                                    <button
                                                        class="row-btn"
                                                        onclick="openProgressModal('${update.month}')"
                                                    >
                                                        Edit
                                                    </button>

                                                    <button
                                                        class="row-btn delete"
                                                        onclick="deleteMonthlyUpdate('${update.month}')"
                                                    >
                                                        Delete
                                                    </button>

                                                </td>

                                            </tr>

                                        `;

                                    }
                                )
                                .join("")
                        }

                    </tbody>

                </table>

            </div>

        `;

    }


    document
        .getElementById(
            "selectedYearArea"
        )
        .innerHTML =
        html;

}


/* =========================================================
   CUMULATIVE DATA
========================================================= */

function calculateCumulativeData(
    year
) {

    if (
        !year.progressUpdates ||
        year.progressUpdates.length === 0
    ) {

        return [];

    }


    const sorted =
        [...year.progressUpdates]
            .sort(
                (a, b) =>
                    a.month.localeCompare(
                        b.month
                    )
            );


    let cumulativeWork = 0;

    let cumulativeExpenditure = 0;


    return sorted.map(
        update => {

            cumulativeWork +=
                Number(
                    update.monthlyWork
                ) || 0;


            cumulativeExpenditure +=
                Number(
                    update.monthlyExpenditure
                ) || 0;


            return {

                ...update,

                cumulativeWork,

                cumulativeExpenditure

            };

        }
    );

}


/* =========================================================
   LATEST PROJECT UPDATE
========================================================= */

function getProjectLatestUpdate(
    project
) {

    let latestInfo = null;


    project.years.forEach(
        year => {

            const data =
                calculateCumulativeData(
                    year
                );


            if (
                data.length === 0
            ) {
                return;
            }


            const latest =
                data[
                    data.length - 1
                ];


            if (
                !latestInfo ||
                latest.month >
                latestInfo.update.month
            ) {

                latestInfo = {

                    update: latest,

                    year

                };

            }

        }
    );


    if (!latestInfo) {
        return null;
    }


    return {

        actualWork:
            latestInfo
                .update
                .cumulativeWork,

        target:
            Number(
                latestInfo
                    .year
                    .plannedWork
            ),

        month:
            latestInfo
                .update
                .month

    };

}


/* =========================================================
   DASHBOARD STATUS
========================================================= */

function updateDashboardStatus(
    project
) {

    const latest =
        getProjectLatestUpdate(
            project
        );


    const badge =
        document.getElementById(
            "dashboardStatus"
        );


    if (!latest) {

        badge.className =
            "status-badge neutral";


        badge.textContent =
            "Not Started";


        return;

    }


    badge.textContent =
        calculateStatus(
            latest.actualWork,
            latest.target
        );


    if (
        badge.textContent ===
        "Behind Target"
    ) {

        badge.className =
            "status-badge danger";

    } else {

        badge.className =
            "status-badge success";

    }

}


/* =========================================================
   LATEST PROGRESS
========================================================= */

function renderLatestProgress(
    project
) {

    const container =
        document.getElementById(
            "latestProgressArea"
        );


    const latest =
        getProjectLatestUpdate(
            project
        );


    if (!latest) {

        container.innerHTML = `

            <div class="empty-small">

                No monthly progress has been recorded yet.

            </div>

        `;

        return;

    }


    const deviation =
        latest.actualWork -
        latest.target;


    container.innerHTML = `

        <div class="latest-grid">

            <div class="latest-item">

                <span>
                    Latest Reporting Month
                </span>

                <strong>
                    ${formatMonth(
                        latest.month
                    )}
                </strong>

            </div>


            <div class="latest-item">

                <span>
                    Current Physical Progress
                </span>

                <strong>
                    ${latest.actualWork.toFixed(2)}%
                </strong>

            </div>


            <div class="latest-item">

                <span>
                    Current Year Target
                </span>

                <strong>
                    ${latest.target.toFixed(2)}%
                </strong>

            </div>


            <div class="latest-item">

                <span>
                    Deviation
                </span>

                <strong>
                    ${
                        deviation > 0
                            ? "+"
                            : ""
                    }${deviation.toFixed(2)}%
                </strong>

            </div>

        </div>

    `;

}


/* =========================================================
   STATUS
========================================================= */

function calculateStatus(
    actual,
    target
) {

    actual =
        Number(actual);


    target =
        Number(target);


    if (
        actual > target
    ) {

        return "Ahead of Target";

    }


    if (
        actual === target
    ) {

        return "Target Achieved";

    }


    return "Behind Target";

}


function statusBadge(
    status
) {

    let className =
        "neutral";


    if (
        status ===
        "Ahead of Target" ||
        status ===
        "Target Achieved"
    ) {

        className =
            "success";

    }


    if (
        status ===
        "Behind Target"
    ) {

        className =
            "danger";

    }


    return `

        <span
            class="status-badge ${className}"
        >
            ${status}
        </span>

    `;

}


/* =========================================================
   PROGRESS MODAL (ADD + EDIT)
========================================================= */

let editingMonth = null;


function openProgressModal(editMonth = null) {

    const project = getCurrentProject();

    if (!project) {
        alert("Please select a project first.");
        return;
    }

    if (selectedYearIndex === null) {
        alert("Please select a project year first.");
        return;
    }

    const year = project.years[selectedYearIndex];

    const input = document.getElementById("updateMonth");

    const title = document.querySelector(
        "#progressModal .modal-header h2"
    );

    input.min = getMonthKey(new Date(year.yearStart + "T00:00:00"));
    input.max = getMonthKey(new Date(year.yearEnd + "T00:00:00"));

    editingMonth = null;
    input.disabled = false;
    title.textContent = "Update Progress";

    if (editMonth) {

        /* EDIT MODE: month is locked, values are pre-filled */

        const existing = (year.progressUpdates || []).find(
            update => update.month === editMonth
        );

        if (!existing) {
            alert("That monthly update could not be found.");
            return;
        }

        editingMonth = editMonth;

        input.value = editMonth;
        input.disabled = true;

        document.getElementById("actualWork").value =
            existing.monthlyWork;

        document.getElementById("actualExpenditure").value =
            existing.monthlyExpenditure;

        title.textContent = "Edit Monthly Update";

    } else {

        /* ADD MODE: suggest the next month */

        const data = calculateCumulativeData(year);

        if (data.length > 0) {

            const latest = data[data.length - 1];

            const next = monthToDate(latest.month);

            next.setMonth(next.getMonth() + 1);

            const nextMonth = getMonthKey(next);

            input.value =
                nextMonth <= input.max
                    ? nextMonth
                    : latest.month;

        } else {

            input.value = input.min;

        }

        document.getElementById("actualWork").value = "";
        document.getElementById("actualExpenditure").value = "";

    }

    document.getElementById("progressModal").classList.add("show");

}


function closeProgressModal() {

    document.getElementById("progressModal").classList.remove("show");

    editingMonth = null;

    document.getElementById("updateMonth").disabled = false;

    const title = document.querySelector(
        "#progressModal .modal-header h2"
    );

    if (title) {
        title.textContent = "Update Progress";
    }

}


/* =========================================================
   DELETE MONTHLY UPDATE
========================================================= */

function deleteMonthlyUpdate(month) {

    const project = getCurrentProject();

    if (!project || selectedYearIndex === null) {
        return;
    }

    const year = project.years[selectedYearIndex];

    if (!year || !year.id) {
        alert("This project year could not be found in the database.");
        return;
    }

    const ok = confirm(
        `Delete the update for ${formatMonth(month)}?\n\nThis cannot be undone.`
    );

    if (!ok) {
        return;
    }

    deleteMonthlyUpdateFromDatabase(year.id, month)
        .then(function() {
            return refreshProjects();
        })
        .then(function() {
            showToast(`${formatMonth(month)} update deleted.`);
            renderDashboard();
        })
        .catch(function(error) {
            alert(
                "The monthly update could not be deleted.\n\n" +
                errorMessage(error)
            );
        });

}


/* =========================================================
   SAVE MONTHLY UPDATE (ADD OR EDIT)
========================================================= */

document
    .getElementById("progressForm")
    .addEventListener("submit", async function(event) {

        event.preventDefault();

        const project = getCurrentProject();

        if (!project) {
            return;
        }

        if (selectedYearIndex === null) {
            alert("Please select a project year.");
            return;
        }

        const year = project.years[selectedYearIndex];

        if (!year || !year.id) {
            alert("This project year could not be found in the database.");
            return;
        }

        const month =
            document.getElementById("updateMonth").value;

        const monthlyWork =
            Number(document.getElementById("actualWork").value);

        const monthlyExpenditure =
            Number(document.getElementById("actualExpenditure").value);

        if (!month) {
            alert("Please select a reporting month.");
            return;
        }

        if (isNaN(monthlyWork) || monthlyWork < 0) {
            alert("Please enter valid monthly work progress.");
            return;
        }

        if (isNaN(monthlyExpenditure) || monthlyExpenditure < 0) {
            alert("Please enter valid monthly expenditure.");
            return;
        }

        const selectedDate = monthToDate(month);

        const startMonth = monthToDate(
            getMonthKey(new Date(year.yearStart + "T00:00:00"))
        );

        const endMonth = monthToDate(
            getMonthKey(new Date(year.yearEnd + "T00:00:00"))
        );

        if (selectedDate < startMonth || selectedDate > endMonth) {
            alert(`The reporting month must be within ${year.label}.`);
            return;
        }

        if (!year.progressUpdates) {
            year.progressUpdates = [];
        }

        const existingIndex = year.progressUpdates.findIndex(
            update => update.month === month
        );

        /* Only ask "replace?" when ADDING over an existing month */

        if (existingIndex !== -1 && editingMonth === null) {

            const replace = confirm(
                `An update already exists for ${formatMonth(month)}.\n\nDo you want to replace it?`
            );

            if (!replace) {
                return;
            }

        }

        /* Totals of all OTHER months in this year */

        let otherWork = 0;
        let otherExpenditure = 0;

        year.progressUpdates.forEach(update => {

            if (update.month === month) {
                return;
            }

            otherWork += Number(update.monthlyWork) || 0;
            otherExpenditure += Number(update.monthlyExpenditure) || 0;

        });

        const newTotalWork = otherWork + monthlyWork;

        if (newTotalWork > 100) {

            alert(
                `Cumulative work cannot exceed 100%.\n\nCumulative work after this update: ${newTotalWork.toFixed(2)}%`
            );

            return;

        }

        const newTotalExpenditure = otherExpenditure + monthlyExpenditure;

        const plannedExpenditure = Number(year.plannedExpenditure);

        if (newTotalExpenditure > plannedExpenditure + 0.0001) {

            alert(
                "Cumulative actual expenditure cannot exceed the planned expenditure for this project year.\n\n" +
                "Planned: " + formatAmount(plannedExpenditure) +
                "\nCumulative after update: " + formatAmount(newTotalExpenditure)
            );

            return;

        }

        const wasEditing = editingMonth !== null;

        const submitButton =
            event.target.querySelector('button[type="submit"]');

        if (submitButton) {
            submitButton.disabled = true;
        }

        try {

            await saveMonthlyUpdateInDatabase(
                year.id,
                month,
                monthlyWork,
                monthlyExpenditure
            );

            await refreshProjects();

            closeProgressModal();

            showToast(
                `${formatMonth(month)} update ${wasEditing ? "updated" : "saved"} successfully.`
            );

            renderDashboard();

        } catch (error) {

            alert(
                "The monthly update could not be saved.\n\n" +
                errorMessage(error)
            );

        } finally {

            if (submitButton) {
                submitButton.disabled = false;
            }

        }

    });

       

/* =========================================================
   MODAL OUTSIDE CLICK
========================================================= */

document
    .getElementById(
        "progressModal"
    )
    .addEventListener(
        "click",
        function(event) {

            if (
                event.target ===
                this
            ) {

                closeProgressModal();

            }

        }
    );


/* =========================================================
   TOAST
========================================================= */

function showToast(
    message
) {

    const toast =
        document.getElementById(
            "toast"
        );


    document
        .getElementById(
            "toastMessage"
        )
        .textContent =
        message;


    toast.classList.add(
        "show"
    );


    setTimeout(
        function() {

            toast.classList.remove(
                "show"
            );

        },
        3000
    );

}


/* =========================================================
   HTML SAFETY
========================================================= */

function escapeHTML(
    value
) {

    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================================
   PROJECT STATUS + SEARCH / FILTER
========================================================= */

function getProjectStatus(project) {

    const latest = getProjectLatestUpdate(project);

    return latest
        ? calculateStatus(latest.actualWork, latest.target)
        : "Not Started";

}


function getFilteredProjects() {

    const search = (
        document.getElementById("projectSearch").value || ""
    ).trim().toLowerCase();

    const type =
        document.getElementById("projectTypeFilter").value;

    const status =
        document.getElementById("projectStatusFilter").value;

    return projects.filter(project => {

        if (type && project.type !== type) {
            return false;
        }

        if (status && getProjectStatus(project) !== status) {
            return false;
        }

        if (search) {

            const text = [
                project.name,
                project.location,
                project.type,
                project.description
            ].join(" ").toLowerCase();

            if (!text.includes(search)) {
                return false;
            }

        }

        return true;

    });

}


function clearProjectFilters() {

    document.getElementById("projectSearch").value = "";
    document.getElementById("projectTypeFilter").value = "";
    document.getElementById("projectStatusFilter").value = "";

    renderProjectsList();

}


["projectSearch", "projectTypeFilter", "projectStatusFilter"].forEach(id => {

    document.getElementById(id).addEventListener(
        "input",
        renderProjectsList
    );

});


/* =========================================================
   EDIT PROJECT
========================================================= */

let editingProjectId = null;

function openEditProject(projectId) {

    const project = projects.find(
        p => sameId(p.id, projectId)
    );

    if (!project) {
        alert("Project could not be found.");
        return;
    }

    editingProjectId = project.id;

    document.getElementById("editProjectName").value =
        project.name;

    document.getElementById("editProjectType").value =
        project.type;

    document.getElementById("editProjectLocation").value =
        project.location;

    document.getElementById("editProjectDescription").value =
        project.description || "";

    document
        .getElementById("editProjectModal")
        .classList.add("show");
}


function closeEditProject() {

    editingProjectId = null;

    document
        .getElementById("editProjectModal")
        .classList.remove("show");
}


document
    .getElementById("editProjectForm")
    .addEventListener("submit", async function(event) {

        event.preventDefault();

        const project = projects.find(
            p => sameId(p.id, editingProjectId)
        );

        if (!project) {
            closeEditProject();
            return;
        }

        const name =
            document
                .getElementById("editProjectName")
                .value
                .trim();

        const type =
            document.getElementById("editProjectType").value;

        const location =
            document
                .getElementById("editProjectLocation")
                .value
                .trim();

        const description =
            document
                .getElementById("editProjectDescription")
                .value
                .trim();

        if (!name) {
            alert("Please enter the project name.");
            return;
        }

        if (!type) {
            alert("Please select the project type.");
            return;
        }

        if (!location) {
            alert("Please enter the project location.");
            return;
        }

        try {

            await updateProjectDetailsInDatabase(
                project.id,
                {
                    name: name,
                    type: type,
                    location: location,
                    description: description
                }
            );

            await refreshProjects();

            closeEditProject();

            renderProjectsList();

            if (sameId(currentProjectId, project.id)) {
                renderDashboard();
            }

            showToast("Project updated successfully.");

        } catch (error) {

            console.error("Edit project error:", error);

            alert(
                "Project could not be updated.\n\n" +
                errorMessage(error)
            );
        }

    });


document
    .getElementById("editProjectModal")
    .addEventListener("click", function(event) {

        if (event.target === this) {
            closeEditProject();
        }

    });


/* =========================================================
   DELETE PROJECT
========================================================= */

async function deleteProject(projectId) {

    const project = projects.find(
        p => sameId(p.id, projectId)
    );

    if (!project) {
        alert("Project could not be found.");
        return;
    }

    const ok = confirm(
        `Delete "${project.name}"?\n\n` +
        "The project and all of its monthly updates will be removed. " +
        "This cannot be undone."
    );

    if (!ok) {
        return;
    }

    try {

        await deleteProjectFromDatabase(project.id);

        projects = projects.filter(
            p => !sameId(p.id, project.id)
        );

        if (sameId(currentProjectId, project.id)) {
            currentProjectId = null;
            selectedYearIndex = null;
        }

        const createdProjectBox =
            document.getElementById("createdProjectBox");

        if (createdProjectBox) {
            createdProjectBox.classList.add("hidden");
        }

        renderProjectsList();
        renderDashboard();

        showPage("projectsPage");

        showToast("Project deleted.");

    } catch (error) {

        console.error("Delete project error:", error);

        alert(
            "Project could not be deleted.\n\n" +
            errorMessage(error)
        );
    }
}


/* =========================================================
   EXPORT / IMPORT BACKUP
========================================================= */

function exportBackup() {

    if (projects.length === 0) {
        alert("There are no projects to export yet.");
        return;
    }

    const backup = {
        app: "InfraTrack",
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: projects
    };

    const blob = new Blob(
        [JSON.stringify(backup, null, 2)],
        {
            type: "application/json"
        }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download =
        "infratrack-backup-" +
        new Date().toISOString().slice(0, 10) +
        ".json";

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    showToast("Backup downloaded.");
}


/* =========================================================
   IMPORT BACKUP
========================================================= */

function isValidProject(project) {

    return (
        project &&
        typeof project === "object" &&
        project.id !== undefined &&
        typeof project.name === "string" &&
        typeof project.type === "string" &&
        typeof project.location === "string" &&
        Array.isArray(project.years)
    );

}


async function importBackup(event) {

    const input = event.target;

    const file = input.files[0];

    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.onload = async function() {

        try {

            const data = JSON.parse(reader.result);

            const list =
                Array.isArray(data)
                    ? data
                    : data.projects;

            if (
                !Array.isArray(list) ||
                !list.every(isValidProject)
            ) {
                throw new Error("Invalid backup file");
            }

            const existingIds = new Set(
                projects.map(p => String(p.id))
            );

            const newProjects = list.filter(
                p => !existingIds.has(String(p.id))
            );

            const skipped =
                list.length - newProjects.length;

            if (newProjects.length === 0) {

                alert(
                    "Nothing to import. All projects in this file already exist."
                );

                return;
            }

            const ok = confirm(
                `Import ${newProjects.length} project(s)?` +
                (
                    skipped > 0
                        ? `\n\n${skipped} project(s) already exist and will be skipped.`
                        : ""
                )
            );

            if (!ok) {
                return;
            }

            /*
             * Import each project using the existing
             * Supabase project creation function.
             *
             * This keeps the same database structure
             * already used by InfraTrack.
             */

            for (const project of newProjects) {

                await createProjectInDatabase(project);

            }

            /*
             * Reload projects from Supabase so the
             * frontend shows the actual database data.
             */

            await reloadFromDatabase();

            showToast(
                `${newProjects.length} project(s) imported successfully.`
            );

        } catch (error) {

            console.error("Import error:", error);

            alert(
                "Import failed.\n\n" +
                errorMessage(error)
            );

        } finally {

            input.value = "";

        }

    };

    reader.readAsText(file);
}
/* =========================================================
   EXPORT / IMPORT BACKUP
========================================================= */

function exportBackup() {

    if (projects.length === 0) {
        alert("There are no projects to export yet.");
        return;
    }

    const backup = {
        app: "InfraTrack",
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: projects
    };

    const blob = new Blob(
        [JSON.stringify(backup, null, 2)],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download =
        "infratrack-backup-" +
        new Date().toISOString().slice(0, 10) +
        ".json";

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    showToast("Backup downloaded.");

}


function isValidProject(project) {

    return (
        project &&
        typeof project === "object" &&
        project.id !== undefined &&
        typeof project.name === "string" &&
        typeof project.type === "string" &&
        typeof project.location === "string" &&
        typeof project.totalBudget === "number" &&
        typeof project.startDate === "string" &&
        typeof project.endDate === "string" &&
        Array.isArray(project.years)
    );

}


/* =========================================================
   IMPORT ONE PROJECT INTO SUPABASE
========================================================= */

async function importProjectToDatabase(project) {

    const client = getSupabase();

    try {

        /* -----------------------------------------------------
           1. INSERT PROJECT
        ----------------------------------------------------- */

        const { data: projectRow, error: projectError } =
            await client
                .from("projects")
                .insert({
                    id: project.id,
                    name: project.name,
                    type: project.type,
                    location: project.location,
                    total_budget: project.totalBudget,
                    start_date: project.startDate,
                    end_date: project.endDate,
                    description: project.description || null
                })
                .select()
                .single();


        if (projectError) {
            throw projectError;
        }


        /* -----------------------------------------------------
           2. INSERT YEAR-WISE PLANNING
        ----------------------------------------------------- */

        const yearRows = (project.years || []).map(
            function(year, index) {

                return {
                    id: year.id,
                    project_id: projectRow.id,
                    year_index: index,
                    label: year.label,
                    start_year: year.startYear,
                    year_start: year.yearStart,
                    year_end: year.yearEnd,
                    planned_work: year.plannedWork,
                    planned_expenditure: year.plannedExpenditure
                };

            }
        );


        let insertedYears = [];


        if (yearRows.length > 0) {

            const { data, error: yearError } =
                await client
                    .from("project_years")
                    .insert(yearRows)
                    .select();


            if (yearError) {
                throw yearError;
            }

            insertedYears = data || [];

        }


        /* -----------------------------------------------------
           3. INSERT MONTHLY PROGRESS UPDATES
        ----------------------------------------------------- */

        const progressRows = [];


        for (let i = 0; i < project.years.length; i++) {

            const sourceYear = project.years[i];

            const databaseYear = insertedYears.find(
                function(year) {
                    return String(year.id) === String(sourceYear.id);
                }
            );


            if (!databaseYear) {
                continue;
            }


            const updates =
                sourceYear.progressUpdates || [];


            for (const update of updates) {

                progressRows.push({
                    id: update.id,
                    project_year_id: databaseYear.id,
                    month: monthToDbDate(update.month),
                    monthly_work: update.monthlyWork,
                    monthly_expenditure: update.monthlyExpenditure,
                    saved_at:
                        update.savedAt ||
                        new Date().toISOString()
                });

            }

        }


        if (progressRows.length > 0) {

            const { error: progressError } =
                await client
                    .from("progress_updates")
                    .insert(progressRows);


            if (progressError) {
                throw progressError;
            }

        }


        /* -----------------------------------------------------
           IMPORT SUCCESS
        ----------------------------------------------------- */

        return projectRow;


    } catch (error) {

        /*
           If anything fails while importing this project,
           remove the partially imported project.

           Supabase cascade delete will also remove:
           project_years
           progress_updates
        */

        try {

            await client
                .from("projects")
                .delete()
                .eq("id", project.id);

        } catch (cleanupError) {

            console.error(
                "Import cleanup error:",
                cleanupError
            );

        }

        throw error;

    }

}


/* =========================================================
   IMPORT BACKUP
========================================================= */

async function importBackup(event) {

    const input = event.target;
    const file = input.files[0];

    if (!file) {
        return;
    }


    try {

        /* -----------------------------------------------------
           READ JSON FILE
        ----------------------------------------------------- */

        const text = await file.text();

        const data = JSON.parse(text);

        const list =
            Array.isArray(data)
                ? data
                : data.projects;


        /* -----------------------------------------------------
           VALIDATE BACKUP
        ----------------------------------------------------- */

        if (
            !Array.isArray(list) ||
            !list.every(isValidProject)
        ) {

            throw new Error(
                "Invalid InfraTrack backup file."
            );

        }


        /* -----------------------------------------------------
           FIND EXISTING PROJECTS
        ----------------------------------------------------- */

        const existingIds = new Set(
            projects.map(function(project) {
                return String(project.id);
            })
        );


        const newProjects = list.filter(
            function(project) {

                return !existingIds.has(
                    String(project.id)
                );

            }
        );


        const skipped =
            list.length - newProjects.length;


        if (newProjects.length === 0) {

            alert(
                "Nothing to import.\n\n" +
                "All projects in this backup already exist."
            );

            return;
        }


        /* -----------------------------------------------------
           CONFIRM
        ----------------------------------------------------- */

        const ok = confirm(

            `Import ${newProjects.length} project(s) into InfraTrack?` +

            (
                skipped > 0
                    ? `\n\n${skipped} project(s) already exist and will be skipped.`
                    : ""
            )

        );


        if (!ok) {
            return;
        }


        /* -----------------------------------------------------
           IMPORT INTO SUPABASE
        ----------------------------------------------------- */

        const importedProjects = [];
        const failedProjects = [];


        for (const project of newProjects) {

            try {

                await importProjectToDatabase(
                    project
                );

                importedProjects.push(project);

            } catch (error) {

                console.error(
                    "Failed to import project:",
                    project.name,
                    error
                );

                failedProjects.push({
                    project: project,
                    error: error
                });

            }

        }


        /* -----------------------------------------------------
           RELOAD EVERYTHING FROM SUPABASE
        ----------------------------------------------------- */

        await refreshProjects();

        renderProjectsList();
        renderDashboard();


        /* -----------------------------------------------------
           RESULT
        ----------------------------------------------------- */

        if (
            importedProjects.length > 0 &&
            failedProjects.length === 0
        ) {

            showToast(
                `${importedProjects.length} project(s) imported successfully.`
            );

            alert(
                `${importedProjects.length} project(s) imported successfully into Supabase.`
            );

        } else if (
            importedProjects.length > 0 &&
            failedProjects.length > 0
        ) {

            alert(

                `${importedProjects.length} project(s) imported successfully.` +

                `\n\n${failedProjects.length} project(s) failed.` +

                "\n\nFailed project(s):" +

                failedProjects
                    .map(function(item) {
                        return "\n• " + item.project.name;
                    })
                    .join("")

            );

        } else {

            alert(
                "No projects were imported into Supabase."
            );

        }


    } catch (error) {

        console.error(
            "Import error:",
            error
        );

        alert(

            "Import failed.\n\n" +

            (error.message || error)

        );

    } finally {

        input.value = "";

    }

}
/* =========================================================
   LOGIN / SIGN UP / LOG OUT (Supabase Auth)
========================================================= */

let authMode = "signin";
let currentUser = null;


function showAuthScreen() {

    document.getElementById("authScreen").classList.add("show");

}


function hideAuthScreen() {

    document.getElementById("authScreen").classList.remove("show");

}


function setAuthMessage(text, type) {

    const box = document.getElementById("authMessage");

    if (!text) {
        box.textContent = "";
        box.className = "auth-message hidden";
        return;
    }

    box.textContent = text;
    box.className = "auth-message " + (type || "error");

}


function setAuthMode(mode) {

    authMode = mode;

    const signingIn = mode === "signin";

    document.getElementById("authTitle").textContent =
        signingIn ? "Sign in" : "Create account";

    document.getElementById("authSubtitle").textContent =
        signingIn
            ? "Sign in to see your projects."
            : "Create an account. Your projects stay private to you.";

    document.getElementById("authSubmit").textContent =
        signingIn ? "Sign in" : "Create account";

    document.getElementById("authSwitchText").textContent =
        signingIn
            ? "Don't have an account?"
            : "Already have an account?";

    document.getElementById("authSwitchBtn").textContent =
        signingIn ? "Create one" : "Sign in";

    document.getElementById("authPassword").autocomplete =
        signingIn ? "current-password" : "new-password";

}


function toggleAuthMode() {

    setAuthMessage("");

    setAuthMode(authMode === "signin" ? "signup" : "signin");

}


document
    .getElementById("authForm")
    .addEventListener("submit", async function(event) {

        event.preventDefault();

        const email =
            document.getElementById("authEmail").value.trim();

        const password =
            document.getElementById("authPassword").value;

        const button = document.getElementById("authSubmit");

        setAuthMessage("");

        button.disabled = true;
        button.textContent = "Please wait...";

        try {

            const client = getSupabase();

            if (authMode === "signin") {

                const { error } = await client.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (error) {
                    throw error;
                }

                /* The auth listener below opens the app. */

            } else {

                const { data, error } = await client.auth.signUp({
                    email: email,
                    password: password
                });

                if (error) {
                    throw error;
                }

                if (!data.session) {

                    /* Email confirmation is switched on in Supabase */

                    setAuthMode("signin");

                    setAuthMessage(
                        "Account created. Check your email and confirm " +
                        "your address, then sign in.",
                        "success"
                    );

                }

            }

        } catch (error) {

            setAuthMessage(errorMessage(error), "error");

        } finally {

            button.disabled = false;

            /* Put the right label back for the current mode */

            setAuthModeLabelOnly();

        }

    });


function setAuthModeLabelOnly() {

    document.getElementById("authSubmit").textContent =
        authMode === "signin" ? "Sign in" : "Create account";

}


function handleSignedIn(user) {

    /* Ignore repeat "signed in" events for the same person
       (the browser can fire them when the tab is refocused). */

    if (currentUser && currentUser.id === user.id) {
        return;
    }

    currentUser = user;

    document.getElementById("sidebarUserEmail").textContent =
        user.email || "";

    document.getElementById("authForm").reset();

    setAuthMessage("");

    hideAuthScreen();

    projects = [];
    currentProjectId = null;
    selectedYearIndex = null;
    appLoading = true;
    appError = null;

    renderProjectsList();
    renderDashboard();

    reloadFromDatabase();

}


function handleSignedOut() {

    currentUser = null;

    projects = [];
    currentProjectId = null;
    selectedYearIndex = null;
    appLoading = false;
    appError = null;

    document.getElementById("progressModal").classList.remove("show");
    document.getElementById("editProjectModal").classList.remove("show");
    document.getElementById("createdProjectBox").classList.add("hidden");

    document.getElementById("sidebarUserEmail").textContent = "";

    renderProjectsList();
    renderDashboard();

    showPage("dashboardPage");

    setAuthMode("signin");

    showAuthScreen();

}


async function signOut() {

    try {

        const { error } = await getSupabase().auth.signOut();

        if (error) {
            throw error;
        }

    } catch (error) {

        alert("Could not log out.\n\n" + errorMessage(error));

        return;

    }

    /* The auth listener also calls this, which is harmless. */

    if (currentUser) {
        handleSignedOut();
    }

}


async function initializeAuth() {

    try {

        const client = getSupabase();

        client.auth.onAuthStateChange(function(event, session) {

            /* Do not call Supabase directly inside this callback;
               hand the work to the next tick. */

            setTimeout(function() {

                if (event === "SIGNED_OUT") {

                    if (currentUser) {
                        handleSignedOut();
                    }

                } else if (session && session.user) {

                    handleSignedIn(session.user);

                }

            }, 0);

        });

        const { data, error } = await client.auth.getSession();

        if (error) {
            throw error;
        }

        if (data.session && data.session.user) {

            handleSignedIn(data.session.user);

        } else {

            showAuthScreen();

        }

    } catch (error) {

        showAuthScreen();

        setAuthMessage(errorMessage(error), "error");

    }

}


/* =========================================================
   INITIALIZE
========================================================= */

function initialize() {

    currentProjectId = null;

    selectedYearIndex = null;

    renderProjectsList();

    renderDashboard();

    initializeAuth();

}

initialize();
