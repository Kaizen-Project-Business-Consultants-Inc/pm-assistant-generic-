import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { scheduleService } from '../../services/ScheduleService';
import { projectService } from '../../services/ProjectService';
import { criticalPathService } from '../../services/CriticalPathService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';
import { heavyActionLimit } from '../../middleware/rateLimiter';

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /exports/projects/:id/export?format=csv|json
  // Trial users get sample export data with an upgrade prompt.
  // The whole project goes out in the file: the caller must be on the project (':id' here isn't
  // under /api/v1/projects, so it has to be resolved explicitly)
  fastify.get('/projects/:id/export', { preHandler: [requireScope('read'), requireProjectAccess('viewer', { resolve: async (req) => (req.params as { id: string }).id }), heavyActionLimit('project-export', 300)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { format } = request.query as { format?: string };

      // Trial users get sample export data
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(request.user!.userId);
        if (user && user.subscriptionTier === 'trial') {
          if (format === 'csv') {
            const csv = generateSampleCSV();
            reply.header('Content-Type', 'text/csv');
            reply.header('Content-Disposition', `attachment; filename="project-${id}-sample-export.csv"`);
            return reply.send(csv);
          }
          if (format === 'xml') {
            const xml = generateSampleXML(id);
            reply.header('Content-Type', 'application/xml');
            reply.header('Content-Disposition', `attachment; filename="project-${id}-sample.xml"`);
            return reply.send(xml);
          }
          // JSON format (used for PDF export and Settings data export)
          return reply.send(generateSampleExport(id));
        }
      }

      const schedules = await scheduleService.findByProjectId(id);

      if (format === 'json') {
        // JSON export — full project report data for client-side PDF rendering
        const project = await projectService.findById(id);

        const schedulesWithTasks = [];
        let allTaskCount = 0;
        let allProgressSum = 0;
        for (const schedule of schedules) {
          // eslint-disable-next-line no-await-in-loop -- small: a project's plans (a handful), each with its own tasks
          const tasks = await scheduleService.findTasksByScheduleId(schedule.id);
          let criticalPath = null;
          try {
            // eslint-disable-next-line no-await-in-loop -- small: one critical path per plan of the project
            criticalPath = await criticalPathService.calculateCriticalPath(schedule.id);
          } catch { /* ignore */ }
          for (const t of tasks) {
            allTaskCount++;
            allProgressSum += t.progressPercentage ?? 0;
          }
          schedulesWithTasks.push({
            id: schedule.id,
            name: schedule.name,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            tasks: tasks.map((t) => ({
              id: t.id,
              name: t.name,
              status: t.status,
              priority: t.priority,
              assignedTo: t.assignedTo || '',
              startDate: t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : '',
              endDate: t.endDate ? new Date(t.endDate).toISOString().slice(0, 10) : '',
              progressPercentage: t.progressPercentage ?? 0,
              dependency: t.dependency || '',
              dependencies: t.dependencies.map(d => ({
                dependencyId: d.dependencyId,
                dependencyType: d.dependencyType,
                lagDays: d.lagDays,
              })),
              parentTaskId: t.parentTaskId || '',
              estimatedDays: t.estimatedDays,
            })),
            criticalPath,
          });
        }

        const avgProgress = allTaskCount > 0 ? Math.round(allProgressSum / allTaskCount) : 0;

        return reply.send({
          project: project ? {
            id: project.id,
            name: project.name,
            status: project.status,
            methodology: project.methodology || 'waterfall',
            budgetAllocated: project.budgetAllocated,
            budgetSpent: project.budgetSpent,
            progressPercentage: avgProgress,
            startDate: project.startDate,
            endDate: project.endDate,
          } : null,
          schedules: schedulesWithTasks,
          generatedAt: new Date().toISOString(),
        });
      }

      if (format === 'xml') {
        // MS Project XML (MSPDI) export
        const project = await projectService.findById(id);
        const projectName = project ? xmlEscape(project.name) : 'Project';

        // Collect all tasks across schedules
        interface XTask { id: string; name: string; startDate?: string; endDate?: string; progressPercentage?: number; isMilestone?: boolean; parentTaskId?: string; assignedTo?: string; dependencies: { dependencyId: string; dependencyType: string; lagDays: number }[]; wbs: string; outlineLevel: number; isParent: boolean; }
        const allTasks: XTask[] = [];
        const parentIds = new Set<string>();

        for (const schedule of schedules) {
          // eslint-disable-next-line no-await-in-loop -- small: a project's plans (a handful), each with its own tasks
          const tasks = await scheduleService.findTasksByScheduleId(schedule.id);
          for (const t of tasks) { if (t.parentTaskId) parentIds.add(t.parentTaskId); }
          // Build WBS by outline level
          const wbsCounters: number[] = [0];
          for (const t of tasks) {
            const level = t.parentTaskId ? 2 : 1; // simplified: 1 for root, 2 for children
            if (level <= wbsCounters.length) wbsCounters.length = level;
            while (wbsCounters.length < level) wbsCounters.push(0);
            wbsCounters[level - 1]++;
            const wbs = wbsCounters.map(n => String(n)).join('.');
            allTasks.push({
              id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate,
              progressPercentage: t.progressPercentage ?? 0, isMilestone: t.isMilestone ?? false,
              parentTaskId: t.parentTaskId, assignedTo: t.assignedTo || '',
              dependencies: t.dependencies.map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays })),
              wbs, outlineLevel: level, isParent: parentIds.has(t.id),
            });
          }
        }

        // Build UID maps
        const taskUidMap = new Map<string, number>();
        allTasks.forEach((t, i) => taskUidMap.set(t.id, i + 1));

        const resourceNames = [...new Set(allTasks.map(t => t.assignedTo).filter(Boolean))] as string[];
        const resourceUidMap = new Map<string, number>();
        resourceNames.forEach((name, i) => resourceUidMap.set(name, i + 1));

        const depTypeMap: Record<string, number> = { FF: 0, FS: 1, SS: 2, SF: 3 };

        // Build XML
        const tasksXml = allTasks.map(t => {
          const uid = taskUidMap.get(t.id)!;
          const start = t.startDate ? toISODate(t.startDate) : '';
          const finish = t.endDate ? toISODate(t.endDate) : '';
          const durationDays = start && finish ? Math.max(1, Math.round((new Date(finish).getTime() - new Date(start).getTime()) / 86400000)) : 1;
          // eslint-disable-next-line no-restricted-syntax -- small: one task's own predecessor links
          const predLinks = t.dependencies.map(d => {
            const predUid = taskUidMap.get(d.dependencyId);
            if (!predUid) return '';
            const type = depTypeMap[d.dependencyType?.toUpperCase() || 'FS'] ?? 1;
            const lag = (d.lagDays || 0) * 4800; // tenths of minutes per day (8h * 60 * 10)
            return `          <PredecessorLink><PredecessorUID>${predUid}</PredecessorUID><Type>${type}</Type><LinkLag>${lag}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`;
          }).filter(Boolean).join('\n');

          return `      <Task>
        <UID>${uid}</UID>
        <ID>${uid}</ID>
        <Name>${xmlEscape(t.name)}</Name>
        <WBS>${t.wbs}</WBS>
        <OutlineLevel>${t.outlineLevel}</OutlineLevel>
        ${start ? `<Start>${start}T08:00:00</Start>` : '<Start />'}
        ${finish ? `<Finish>${finish}T17:00:00</Finish>` : '<Finish />'}
        <Duration>${durationISO(durationDays)}</Duration>
        <Milestone>${t.isMilestone ? 1 : 0}</Milestone>
        <Summary>${t.isParent ? 1 : 0}</Summary>
        <PercentComplete>${t.progressPercentage}</PercentComplete>
${predLinks ? predLinks + '\n' : ''}      </Task>`;
        }).join('\n');

        const resourcesXml = resourceNames.map(name => {
          const uid = resourceUidMap.get(name);
          if (!uid) return '';
          return `      <Resource><UID>${uid}</UID><ID>${uid}</ID><Name>${xmlEscape(name)}</Name><Type>1</Type></Resource>`;
        }).filter(Boolean).join('\n');

        let assignmentUid = 0;
        const assignmentsXml = allTasks.filter(t => t.assignedTo).map(t => {
          const tUid = taskUidMap.get(t.id);
          const rUid = resourceUidMap.get(t.assignedTo!);
          if (!tUid || !rUid) return '';
          assignmentUid++;
          return `      <Assignment><UID>${assignmentUid}</UID><TaskUID>${tUid}</TaskUID><ResourceUID>${rUid}</ResourceUID></Assignment>`;
        }).filter(Boolean).join('\n');

        const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>${projectName}</Name>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <WeekDays>
        <WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>
        <WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay>
      </WeekDays>
    </Calendar>
  </Calendars>
  <Tasks>
${tasksXml}
  </Tasks>
  <Resources>
${resourcesXml}
  </Resources>
  <Assignments>
${assignmentsXml}
  </Assignments>
</Project>`;

        reply.header('Content-Type', 'application/xml');
        reply.header('Content-Disposition', `attachment; filename="project-${id}.xml"`);
        return reply.send(xml);
      }

      if (format !== 'csv') {
        return reply.status(400).send({ error: 'Supported formats: csv, json, xml' });
      }

      const headers = [
        'Schedule',
        'Task ID',
        'Task Name',
        'Status',
        'Priority',
        'Assigned To',
        'Start Date',
        'End Date',
        'Progress %',
        'Predecessors',
        'Parent Task',
      ];

      const rows: string[][] = [];

      for (const schedule of schedules) {
        // eslint-disable-next-line no-await-in-loop -- small: a project's plans (a handful), each with its own tasks
        const tasks = await scheduleService.findTasksByScheduleId(schedule.id);
        // Build row number map for MS Project-style predecessor labels
        const taskRowNum = new Map<string, number>();
        tasks.forEach((t, idx) => taskRowNum.set(t.id, idx + 1));

        for (const task of tasks) {
          // Build predecessor string in MS Project format: "3FS+2d,5SS"
          // eslint-disable-next-line no-restricted-syntax -- small: one task's own predecessor links
          const predLabels = task.dependencies.map(d => {
            const rowNum = taskRowNum.get(d.dependencyId);
            if (!rowNum) return '';
            let label = String(rowNum);
            if (d.dependencyType !== 'FS') label += d.dependencyType;
            if (d.lagDays !== 0) label += (d.lagDays > 0 ? `+${d.lagDays}d` : `${d.lagDays}d`);
            return label;
          }).filter(Boolean);

          rows.push([
            schedule.name,
            task.id,
            task.name,
            task.status,
            task.priority,
            task.assignedTo || '',
            task.startDate ? new Date(task.startDate).toISOString().slice(0, 10) : '',
            task.endDate ? new Date(task.endDate).toISOString().slice(0, 10) : '',
            String(task.progressPercentage ?? 0),
            predLabels.join(','),
            task.parentTaskId || '',
          ]);
        }
      }

      // Escape CSV fields
      function escapeCSV(field: string): string {
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
          return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
      }

      const csv = [
        headers.map(escapeCSV).join(','),
        ...rows.map((row) => row.map(escapeCSV).join(',')),
      ].join('\n');

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="project-${id}-export.csv"`);
      return reply.send(csv);
    } catch (error) {
      logger.error('Export error', { error });
      return reply.status(500).send({ error: 'Failed to export project data' });
    }
  });
}

// XML helpers
function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function toISODate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

function durationISO(days: number): string {
  return `PT${days * 8}H0M0S`;
}

function generateSampleCSV(): string {
  const today = new Date();
  const addDays = (n: number) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  return [
    'Schedule,Task ID,Task Name,Status,Priority,Assigned To,Start Date,End Date,Progress %,Predecessors,Parent Task',
    `Phase 1 — Discovery,s1,Stakeholder Interviews,completed,high,Jane Smith,${addDays(-60)},${addDays(-50)},100,,`,
    `Phase 1 — Discovery,s2,Requirements Document,completed,high,John Doe,${addDays(-50)},${addDays(-35)},100,1FS,`,
    `Phase 2 — Development,s3,Frontend Development,in_progress,high,Alex Chen,${addDays(-25)},${addDays(10)},65,,`,
    `Phase 2 — Development,s4,Backend API,in_progress,medium,Sarah Kim,${addDays(-20)},${addDays(15)},45,,`,
    `Phase 2 — Development,s5,QA Testing,not_started,high,Mike Brown,${addDays(15)},${addDays(40)},0,3FS+2d,`,
  ].join('\n');
}

function generateSampleXML(projectId: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Sample Project — Website Redesign</Name>
  <Tasks>
    <Task><UID>1</UID><ID>1</ID><Name>Stakeholder Interviews</Name><WBS>1</WBS><OutlineLevel>1</OutlineLevel><PercentComplete>100</PercentComplete><Milestone>0</Milestone><Summary>0</Summary></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Requirements Document</Name><WBS>2</WBS><OutlineLevel>1</OutlineLevel><PercentComplete>100</PercentComplete><Milestone>0</Milestone><Summary>0</Summary><PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
    <Task><UID>3</UID><ID>3</ID><Name>Frontend Development</Name><WBS>3</WBS><OutlineLevel>1</OutlineLevel><PercentComplete>65</PercentComplete><Milestone>0</Milestone><Summary>0</Summary></Task>
    <Task><UID>4</UID><ID>4</ID><Name>Backend API</Name><WBS>4</WBS><OutlineLevel>1</OutlineLevel><PercentComplete>45</PercentComplete><Milestone>0</Milestone><Summary>0</Summary></Task>
    <Task><UID>5</UID><ID>5</ID><Name>QA Testing</Name><WBS>5</WBS><OutlineLevel>1</OutlineLevel><PercentComplete>0</PercentComplete><Milestone>0</Milestone><Summary>0</Summary></Task>
  </Tasks>
  <Resources />
  <Assignments />
</Project>`;
}

function generateSampleExport(projectId: string) {
  const today = new Date();
  const addDays = (n: number) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  return {
    sample: true,
    project: {
      id: projectId,
      name: 'Sample Project — Website Redesign',
      status: 'active',
      methodology: 'agile',
      budgetAllocated: 150000,
      budgetSpent: 87000,
      progressPercentage: 58,
      startDate: addDays(-60),
      endDate: addDays(45),
    },
    schedules: [
      {
        id: 'sample-sched-1',
        name: 'Phase 1 — Discovery',
        startDate: addDays(-60),
        endDate: addDays(-30),
        tasks: [
          { id: 's1', name: 'Stakeholder Interviews', status: 'completed', priority: 'high', assignedTo: 'Jane Smith', startDate: addDays(-60), endDate: addDays(-50), progressPercentage: 100, dependency: '', dependencies: [], parentTaskId: '', estimatedDays: 10 },
          { id: 's2', name: 'Requirements Document', status: 'completed', priority: 'high', assignedTo: 'John Doe', startDate: addDays(-50), endDate: addDays(-35), progressPercentage: 100, dependency: '', dependencies: [{ dependencyId: 's1', dependencyType: 'FS', lagDays: 0 }], parentTaskId: '', estimatedDays: 15 },
        ],
        criticalPath: null,
      },
      {
        id: 'sample-sched-2',
        name: 'Phase 2 — Development',
        startDate: addDays(-30),
        endDate: addDays(45),
        tasks: [
          { id: 's3', name: 'Frontend Development', status: 'in_progress', priority: 'high', assignedTo: 'Alex Chen', startDate: addDays(-25), endDate: addDays(10), progressPercentage: 65, dependency: '', dependencies: [], parentTaskId: '', estimatedDays: 35 },
          { id: 's4', name: 'Backend API', status: 'in_progress', priority: 'medium', assignedTo: 'Sarah Kim', startDate: addDays(-20), endDate: addDays(15), progressPercentage: 45, dependency: '', dependencies: [], parentTaskId: '', estimatedDays: 35 },
          { id: 's5', name: 'QA Testing', status: 'not_started', priority: 'high', assignedTo: 'Mike Brown', startDate: addDays(15), endDate: addDays(40), progressPercentage: 0, dependency: '', dependencies: [{ dependencyId: 's3', dependencyType: 'FS', lagDays: 2 }], parentTaskId: '', estimatedDays: 25 },
        ],
        criticalPath: null,
      },
    ],
    generatedAt: today.toISOString(),
  };
}
