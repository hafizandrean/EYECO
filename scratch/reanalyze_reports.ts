import path from 'path';
import fs from 'fs';
import { connectDB } from '../src/database/db';
import { ReportModel } from '../src/database/models/Report';
import { aiEngine } from '../src/services/ai/aiEngine';

async function reanalyzeTarget() {
  await connectDB();
  console.log('[REANALYZE] Target re-analyzing Report #363...');

  const report = await ReportModel.findOne({ id: 363 }).exec();
  if (!report || !report.image) {
    console.error('Report #363 not found!');
    process.exit(1);
  }

  let imgFileName = path.basename(report.image);
  let absPath = path.resolve(__dirname, '../public/uploads', imgFileName);
  if (!fs.existsSync(absPath)) {
    absPath = path.resolve(__dirname, '../uploads', imgFileName);
  }

  console.log(`[REANALYZE] Processing Report #363 (${absPath})...`);
  const analysis = await aiEngine.analyze(absPath, { reportId: report.id, forceReanalysis: true });

  await ReportModel.updateOne(
    { _id: report._id },
    {
      $set: {
        aiStatus: analysis.decision.status,
        aiConfidence: analysis.decision.objectConfidence,
        violationScore: analysis.decision.violationScore,
        objectConfidence: analysis.decision.objectConfidence,
        sceneConfidence: analysis.decision.sceneConfidence,
        decisionConfidence: analysis.decision.decisionConfidence,
        uncertaintyScore: analysis.decision.uncertaintyScore,
        priority: analysis.decision.priority,
        recommendedAction: analysis.decision.recommendedAction,
        activeSnapshotId: analysis.snapshot._id,
        boundingBoxes: analysis.objects.map((o: any) => ({
          label: o.class,
          confidence: o.confidence,
          x: o.x,
          y: o.y,
          w: o.w,
          h: o.h
        })),
      }
    }
  ).exec();

  console.log(`[REANALYZE] Report #363 updated -> Status: ${analysis.decision.status}, Score: ${analysis.decision.violationScore}, BBoxes: ${JSON.stringify(analysis.objects.map((o:any)=>[o.class, o.x, o.y, o.w, o.h]))}`);
  process.exit(0);
}

reanalyzeTarget();
