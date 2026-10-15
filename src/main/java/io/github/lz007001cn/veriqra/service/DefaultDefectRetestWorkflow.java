package io.github.lz007001cn.veriqra.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.exception.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.query.*;
import io.github.lz007001cn.veriqra.service.support.*;
import java.security.*;
import java.util.*;

/** R1 rules over immutable execution facts. Every mutation rechecks authority inside its transaction. */
final class DefaultDefectRetestWorkflow {
    private final ServiceTransaction tx;
    private final ServiceDaoFactory factory;
    private final ProjectAccessPolicy access;
    private static final ObjectMapper JSON=new ObjectMapper();
    DefaultDefectRetestWorkflow(ServiceTransaction tx,ServiceDaoFactory factory,ProjectAccessPolicy access) {
        this.tx=Objects.requireNonNull(tx);this.factory=Objects.requireNonNull(factory);this.access=Objects.requireNonNull(access);
    }
    ClosureEligibility eligibility(Long actor,Long project,Long defect) {
        positive(project,"projectId");positive(defect,"defectId");
        return tx.execute(c->{var d=factory.create(c);var packet=discover(d,actor,project,defect,null);
            var graph=graph(d,packet,false);return evaluate(d,packet.defect(),d.attemptDefects().listAttemptsByDefect(defect),graph,false);});
    }
    RetestCandidates candidates(Long actor,Long project,Long defect,Long failure,Long cursor,int size) {
        positive(failure,"failureAttemptId");if(cursor!=null)positive(cursor,"cursor");
        if(size<1 || size>100)throw new ValidationException("pageSize must be between 1 and 100");
        return tx.execute(c->{var d=factory.create(c);var packet=discover(d,actor,project,defect,null);
            if(!packet.failureIds().contains(failure))throw new NotFoundException("Failure evidence unavailable");
            var g=graph(d,packet,false);var source=g.context(failure);
            List<TestAttempt> list=g.attempts().values().stream().filter(a->a.status()==TestAttemptStatus.PASS)
                    .filter(a->g.runCases().get(a.testRunCaseId()).testCaseId().equals(source.runCase().testCaseId()))
                    .filter(a->cursor==null || a.id()<cursor).sorted(Comparator.comparing(TestAttempt::id).reversed()).toList();
            List<RetestCandidates.Candidate> items=new ArrayList<>();
            for(var a:list.stream().limit(size).toList()) {var target=g.context(a.id());var reasons=check(g,source,target);
                items.add(new RetestCandidates.Candidate(g.evidence(target),reasons,reasons.isEmpty(),a.importId()!=null));}
            return new RetestCandidates(failure,items,list.size()>size?items.getLast().execution().attempt().id():null);
        });
    }
    RetestOperationResult link(Long actor,Long project,LinkRetestCommand cmd) {
        Objects.requireNonNull(cmd);positive(cmd.defectId(),"defectId");positive(cmd.failureAttemptId(),"failureAttemptId");positive(cmd.passAttemptId(),"passAttemptId");
        version(cmd.expectedVersion());ServiceValidation.required(cmd.requestKey(),"requestKey");
        ServiceValidation.requiredText(cmd.reviewNote(),2000,"reviewNote");ServiceValidation.required(cmd.timingBasis(),"timingBasis");
        if(cmd.oldLinkId()!=null){positive(cmd.oldLinkId(),"oldLinkId");ServiceValidation.requiredText(cmd.revokeReason(),2000,"revokeReason");}
        else if(cmd.revokeReason()!=null)throw new ValidationException("revokeReason requires oldLinkId");
        Sha256Digest hash=hash("LINK",actor,project,cmd.defectId(),cmd.expectedVersion(),cmd.failureAttemptId(),cmd.passAttemptId(),cmd.oldLinkId(),cmd.reviewNote(),cmd.timingBasis().name(),cmd.revokeReason());
        Packet packet=tx.execute(c->discover(factory.create(c),actor,project,cmd.defectId(),cmd.passAttemptId()));
        return mutate(c->{var d=factory.create(c);writable(d,actor,project);var g=graph(d,packet,true);
            var current=d.defects().findByIdForUpdate(cmd.defectId()).orElseThrow(()->new NotFoundException("Defect unavailable"));
            ProjectOwnership.require(current.projectId(),project);
            var selections=d.retestLinks().listByDefectForUpdate(current.id());
            var keys=d.retestLinks().listByRequestKeyForUpdate(cmd.requestKey());
            var existing=keys.stream().filter(x->x.requestKey().equals(cmd.requestKey())).findFirst();
            if(existing.isPresent()) {var row=existing.get();replay(row,actor,cmd.defectId(),hash,false);return operation(d,row,"LINK",true,g);}
            if(!keys.isEmpty())throw rule("REQUEST_KEY_CONFLICT");
            mutable(current,cmd.expectedVersion());
            var sources=d.attemptDefects().listAttemptsByDefectForUpdate(current.id());verifySources(packet,sources);
            if(!sources.stream().anyMatch(x->x.attemptId().equals(cmd.failureAttemptId())))throw new NotFoundException("Failure evidence unavailable");
            var source=g.context(cmd.failureAttemptId());var target=g.context(cmd.passAttemptId());requireFailure(source);
            List<String> reasons=check(g,source,target);if(!reasons.isEmpty())throw rule(reasons.getFirst());
            DefectRetestTimingBasis required=target.attempt().importId()==null?DefectRetestTimingBasis.MANUAL_SERVER_RECORD:DefectRetestTimingBasis.IMPORT_REVIEW_ATTESTATION;
            if(cmd.timingBasis()!=required)throw rule("IMPORT_CONFIRMATION_REQUIRED");
            var active=selections.stream().filter(x->x.failureAttemptId().equals(cmd.failureAttemptId()) && x.revocation()==null).findFirst();
            if(cmd.oldLinkId()==null && active.isPresent())throw rule("ACTIVE_SELECTION_EXISTS");
            if(cmd.oldLinkId()!=null && (active.isEmpty() || !active.get().id().equals(cmd.oldLinkId())))throw rule("RETEST_SELECTION_CHANGED");
            Defect updated=bump(d,current,current.status());
            if(active.isPresent()) {
                boolean done=d.retestLinks().revoke(active.get().id(),current.id(),new DefectRetestRevocation(actor,null,cmd.revokeReason(),DefectRetestRevocationOperation.REPLACE,cmd.requestKey(),hash,updated.lockVersion()));
                if(!done)throw rule("RETEST_SELECTION_CHANGED");
            }
            var inserted=d.retestLinks().insert(new DefectRetestLink(null,current.id(),cmd.failureAttemptId(),cmd.passAttemptId(),DefectRetestLink.POLICY,actor,null,cmd.reviewNote(),cmd.timingBasis(),cmd.requestKey(),hash,updated.lockVersion(),null));
            return operation(d,inserted,"LINK",false,g);
        });
    }
    RetestOperationResult revoke(Long actor,Long project,RevokeRetestCommand cmd) {
        Objects.requireNonNull(cmd);positive(cmd.defectId(),"defectId");positive(cmd.linkId(),"linkId");version(cmd.expectedVersion());ServiceValidation.required(cmd.requestKey(),"requestKey");
        ServiceValidation.requiredText(cmd.reason(),2000,"reason");
        Sha256Digest hash=hash("REVOKE",actor,project,cmd.defectId(),cmd.expectedVersion(),null,null,cmd.linkId(),null,null,cmd.reason());
        Packet packet=tx.execute(c->discover(factory.create(c),actor,project,cmd.defectId(),null));
        return mutate(c->{var d=factory.create(c);writable(d,actor,project);var g=graph(d,packet,true);
            Defect current=d.defects().findByIdForUpdate(cmd.defectId()).orElseThrow(()->new NotFoundException("Defect unavailable"));ProjectOwnership.require(current.projectId(),project);
            var selections=d.retestLinks().listByDefectForUpdate(current.id());
            var keys=d.retestLinks().listByRequestKeyForUpdate(cmd.requestKey());
            var existing=keys.stream().filter(x->x.revocation()!=null && x.revocation().operation()==DefectRetestRevocationOperation.REVOKE && x.revocation().requestKey().equals(cmd.requestKey())).findFirst();
            if(existing.isPresent()){replay(existing.get(),actor,cmd.defectId(),hash,true);return operation(d,existing.get(),"REVOKE",true,g);}
            if(!keys.isEmpty())throw rule("REQUEST_KEY_CONFLICT");
            // A REPLACE marker cannot be misidentified as an independent REVOKE.
            if(selections.stream().anyMatch(x->x.revocation()!=null && x.revocation().operation()==DefectRetestRevocationOperation.REPLACE && x.revocation().requestKey().equals(cmd.requestKey())))throw rule("REQUEST_KEY_CONFLICT");
            mutable(current,cmd.expectedVersion());verifySources(packet,d.attemptDefects().listAttemptsByDefectForUpdate(current.id()));
            var row=d.retestLinks().findByIdForUpdate(cmd.linkId()).filter(x->x.defectId().equals(current.id())).orElseThrow(()->new NotFoundException("Retest selection unavailable"));
            if(row.revocation()!=null)throw rule("RETEST_ALREADY_REVOKED");
            var updated=bump(d,current,current.status());
            if(!d.retestLinks().revoke(row.id(),current.id(),new DefectRetestRevocation(actor,null,cmd.reason(),DefectRetestRevocationOperation.REVOKE,cmd.requestKey(),hash,updated.lockVersion())))throw rule("RETEST_SELECTION_CHANGED");
            return operation(d,d.retestLinks().findByIdForUpdate(row.id()).orElseThrow(),"REVOKE",false,g);
        });
    }
    Optional<RetestOperationResult> recover(Long actor,Long project,Long defect,UUID key,String action) {
        ServiceValidation.required(key,"requestKey");if(action==null || !Set.of("LINK","REVOKE").contains(action))throw new ValidationException("action must be LINK or REVOKE");
        return tx.execute(c->{var d=factory.create(c);Defect current=find(d,defect);ProjectOwnership.require(current.projectId(),project);access.requireProjectRead(d.users(),d.members(),actor,project);
            var row=action.equals("LINK")?d.retestLinks().findByLinkRequestKey(key):d.retestLinks().findByRevokeRequestKey(key);
            return row.filter(x->x.defectId().equals(defect)).filter(x->action.equals("LINK")?x.linkedBy().equals(actor):x.revocation().revokedBy().equals(actor)).map(x->operation(d,x,action,true));});
    }
    Defect close(Long actor,Long project,TransitionDefectCommand cmd) {
        Packet packet=tx.execute(c->{var d=factory.create(c);var value=find(d,cmd.defectId());Long scope=project==null?value.projectId():project;return discover(d,actor,scope,cmd.defectId(),null);});
        return mutate(c->{var d=factory.create(c);Long scope=packet.defect().projectId();writable(d,actor,scope);var g=graph(d,packet,true);
            Defect current=d.defects().findByIdForUpdate(cmd.defectId()).orElseThrow(()->new NotFoundException("Defect unavailable"));mutable(current,cmd.lockVersion());
            if(current.status()!=DefectStatus.RESOLVED)throw rule("NOT_RESOLVED");
            var sources=d.attemptDefects().listAttemptsByDefectForUpdate(current.id());verifySources(packet,sources);
            ClosureEligibility check=evaluate(d,current,sources,g,true);
            if(sources.isEmpty())throw rule("NO_FAIL_EVIDENCE");
            for(var failure:check.failures())if(!failure.eligible())throw rule(failure.reasons().getFirst());
            String note=cmd.resolutionNote()==null?current.resolutionNote():ServiceValidation.requiredText(cmd.resolutionNote(),Integer.MAX_VALUE,"resolutionNote");
            ServiceValidation.requiredText(note,Integer.MAX_VALUE,"resolutionNote");
            Defect closed=update(d,new Defect(current.id(),scope,current.keyNo(),current.title(),current.description(),current.severity(),current.priority(),DefectStatus.CLOSED,current.reporterId(),current.assigneeId(),note,current.createdAt(),current.updatedAt(),current.lockVersion()));
            var receipt=d.closureReceipts().insert(new DefectClosureReceipt(null,current.id(),closed.lockVersion(),actor,null,DefectClosureReceipt.POLICY,note,sources.size()));
            for(var failure:check.failures())d.closureItems().insert(new DefectClosureItem(receipt.id(),failure.source().attempt().id(),current.id(),failure.selectedPass().attempt().id(),failure.selection()==null?null:failure.selection().id(),failure.selection()==null?DefectClosureEvidencePolicy.SAME_RUN_CASE_V1:DefectClosureEvidencePolicy.EXACT_SEMANTIC_V1));
            return closed;
        });
    }
    RunCompletionImpact impact(Long actor,Long project,Long runId) {
        return tx.execute(c->{var d=factory.create(c);var run=d.testRuns().findById(runId).orElseThrow(()->new NotFoundException("Run unavailable"));ProjectOwnership.require(run.projectId(),project);access.requireProjectRead(d.users(),d.members(),actor,project);
            Map<String,Long> counts=new LinkedHashMap<>();for(String code:List.of("PASS","FAIL","BLOCKED","SKIPPED","NOT_RUN"))counts.put(code,0L);
            Set<Long> defects=new TreeSet<>();
            for(var rc:d.runCases().listByRun(runId)){
                var latest=d.attempts().findLatestByRunCase(rc.id());String code=latest.map(x->x.status().name()).orElse("NOT_RUN");counts.put(code,counts.get(code)+1);
                for(var a:d.attempts().listByRunCase(rc.id()))if(a.status()==TestAttemptStatus.FAIL)for(var link:d.attemptDefects().listDefectsByAttempt(a.id()))defects.add(link.defectId());
            }
            long open=0,pending=0;
            for(Long id:defects){var value=find(d,id);ProjectOwnership.require(value.projectId(),project);if(value.status()==DefectStatus.CLOSED)continue;open++;
                var packet=discover(d,actor,project,id,null);var e=evaluate(d,value,d.attemptDefects().listAttemptsByDefect(id),graph(d,packet,false),false);
                if(e.failures().isEmpty() || e.failures().stream().anyMatch(x->!x.eligible()))pending++;
            }
            return new RunCompletionImpact(runId,run.status(),counts,open,pending);
        });
    }
    private Packet discover(ServiceDaos d,Long actor,Long project,Long defect,Long target) {
        positive(project,"projectId");positive(defect,"defectId");Defect value=find(d,defect);ProjectOwnership.require(value.projectId(),project);access.requireProjectRead(d.users(),d.members(),actor,project);
        List<Long> failures=d.attemptDefects().listAttemptsByDefect(defect).stream().map(TestAttemptDefect::attemptId).sorted().toList();
        Set<Long> cases=new TreeSet<>();for(Long id:failures){var ctx=context(d,id);if(!ctx.run().projectId().equals(project))throw rule("CROSS_PROJECT");cases.add(ctx.runCase().testCaseId());}
        for(var link:d.retestLinks().listByDefect(defect)){var ctx=context(d,link.passAttemptId());if(!ctx.run().projectId().equals(project))throw rule("CROSS_PROJECT");cases.add(ctx.runCase().testCaseId());}
        if(target!=null){var ctx=context(d,target);if(!ctx.run().projectId().equals(project))throw rule("CROSS_PROJECT");cases.add(ctx.runCase().testCaseId());}
        return new Packet(value,failures,List.copyOf(cases));
    }
    private Graph graph(ServiceDaos d,Packet packet,boolean locked) {
        Long project=packet.defect().projectId();Map<Long,TestCase> cases=new TreeMap<>();Map<Long,List<TestStep>> currentSteps=new HashMap<>();
        for(Long id:packet.caseIds()){
            TestCase value=(locked?d.testCases().findByIdForUpdate(id):d.testCases().findById(id)).orElseThrow(()->new NotFoundException("Test case unavailable"));
            ProjectOwnership.require(value.projectId(),project);cases.put(id,value);
        }
        for(Long id:cases.keySet())currentSteps.put(id,locked?d.steps().listByTestCaseForShare(id):d.steps().listByTestCase(id));
        Map<Long,TestRun> runs=new TreeMap<>();Map<Long,TestRunCase> rc=new TreeMap<>();
        // Lock Run before RunCase. Project-wide Run discovery deliberately handles an older RR view.
        // Returned runs are project-scoped; the project index still takes conservative range/gap locks.
        // Same-project unrelated runs and index range boundaries can therefore cause contention.
        List<TestRun> runList=locked?d.testRuns().listByProjectForUpdate(project):d.testRuns().listByProject(project);
        for(var run:runList){runs.put(run.id(),run);for(var item:locked?d.runCases().listByRunForUpdate(run.id()):d.runCases().listByRun(run.id()))if(cases.containsKey(item.testCaseId()))rc.put(item.id(),item);}
        Map<Long,List<TestRunCaseStep>> steps=new HashMap<>();Map<Long,List<TestAttempt>> history=new HashMap<>();Map<Long,TestAttempt> attempts=new TreeMap<>();
        for(Long id:rc.keySet()){
            steps.put(id,locked?d.runCaseSteps().listByRunCaseForShare(id):d.runCaseSteps().listByRunCase(id));
            var list=locked?d.attempts().listByRunCaseForUpdate(id):d.attempts().listByRunCase(id);history.put(id,list);for(var a:list)attempts.put(a.id(),a);
        }
        return new Graph(cases,currentSteps,runs,rc,steps,history,attempts);
    }
    private ClosureEligibility evaluate(ServiceDaos d,Defect value,List<TestAttemptDefect> sources,Graph g,boolean locked) {
        var links=locked?d.retestLinks().listByDefectForUpdate(value.id()):d.retestLinks().listByDefect(value.id());
        Map<Long,DefectRetestLink> active=new HashMap<>();for(var link:links)if(link.revocation()==null)active.put(link.failureAttemptId(),link);
        List<ClosureEligibility.Failure> failures=new ArrayList<>();
        for(var sourceLink:sources){var source=g.context(sourceLink.attemptId());requireFailure(source);Context selected=null;RetestSelection selection=null;
            var link=active.get(source.attempt().id());
            if(link!=null){selected=g.context(link.passAttemptId());selection=selection(link,selected);}
            else {var list=g.history().get(source.runCase().id());if(!list.isEmpty()){var latest=list.getLast();if(latest.status()==TestAttemptStatus.PASS && latest.attemptNo()>source.attempt().attemptNo())selected=g.context(latest.id());}}
            List<String> reasons=selected==null?List.of("MISSING_RETEST"):check(g,source,selected);
            failures.add(new ClosureEligibility.Failure(g.evidence(source),selected==null?null:g.evidence(selected),selection,reasons,reasons.isEmpty(),source.run().status()==TestRunStatus.IN_PROGRESS,g.compatibleCurrent(source.runCase())));
        }
        List<String> reasons=new ArrayList<>();if(value.status()!=DefectStatus.RESOLVED)reasons.add("NOT_RESOLVED");if(sources.isEmpty())reasons.add("NO_FAIL_EVIDENCE");
        List<ClosureEligibility.History> history=new ArrayList<>();
        for(var receipt:locked?List.<DefectClosureReceipt>of():d.closureReceipts().listByDefect(value.id())){
            List<ClosureEligibility.ClosedEvidence> items=new ArrayList<>();
            for(var item:d.closureItems().listByReceipt(receipt.id()))items.add(new ClosureEligibility.ClosedEvidence(evidence(d,context(d,item.failureAttemptId())),evidence(d,context(d,item.passAttemptId())),item.retestLinkId(),item.evidencePolicy()));
            history.add(new ClosureEligibility.History(receipt,items));
        }
        return new ClosureEligibility(value,value.lockVersion(),reasons.isEmpty() && failures.stream().allMatch(ClosureEligibility.Failure::eligible),reasons,failures,history,value.status()==DefectStatus.CLOSED && history.isEmpty());
    }
    private static List<String> check(Graph g,Context failure,Context pass) {
        List<String> reasons=new ArrayList<>();
        if(!failure.run().projectId().equals(pass.run().projectId()))return List.of("CROSS_PROJECT");
        if(!failure.runCase().testCaseId().equals(pass.runCase().testCaseId()))return List.of("DIFFERENT_TEST_CASE");
        if(pass.attempt().status()!=TestAttemptStatus.PASS)reasons.add("NOT_PASS");
        if(!same(failure.runCase(),g.steps().get(failure.runCase().id()),pass.runCase(),g.steps().get(pass.runCase().id())))reasons.add("DEFINITION_MISMATCH");
        boolean sameRC=failure.runCase().id().equals(pass.runCase().id());
        if(sameRC?pass.attempt().attemptNo()<=failure.attempt().attemptNo():!pass.attempt().recordedAt().isAfter(failure.attempt().recordedAt()))reasons.add("RETEST_TOO_OLD");
        var own=g.history().get(pass.runCase().id());if(own.isEmpty() || !own.getLast().id().equals(pass.attempt().id()))reasons.add("LATEST_NOT_PASS");
        for(var rc:g.runCases().values()){
            if(!rc.testCaseId().equals(failure.runCase().testCaseId()) || !same(failure.runCase(),g.steps().get(failure.runCase().id()),rc,g.steps().get(rc.id())))continue;
            for(var a:g.history().get(rc.id()))if(a.status()!=TestAttemptStatus.PASS){
                boolean later=rc.id().equals(pass.runCase().id())?a.attemptNo()>pass.attempt().attemptNo():!a.recordedAt().isBefore(pass.attempt().recordedAt());
                if(later && !reasons.contains("LATER_NON_PASS"))reasons.add("LATER_NON_PASS");
            }
        }
        return List.copyOf(reasons);
    }
    private static boolean same(TestRunCase a,List<TestRunCaseStep> as,TestRunCase b,List<TestRunCaseStep> bs) {
        if(!Objects.equals(a.snapshotTitle(),b.snapshotTitle()) || !Objects.equals(a.snapshotDescription(),b.snapshotDescription()) || !Objects.equals(a.snapshotPreconditions(),b.snapshotPreconditions()))return false;
        return sameSteps(as,bs);
    }
    private static boolean sameSteps(List<TestRunCaseStep> a,List<TestRunCaseStep> b) {
        if(a==null || b==null || a.isEmpty() || a.size()!=b.size())return false;
        for(int i=0;i<a.size();i++)if(a.get(i).stepOrder()!=i+1 || b.get(i).stepOrder()!=i+1 || a.get(i).action()==null || a.get(i).action().isBlank() || a.get(i).expectedResult()==null || a.get(i).expectedResult().isBlank()
                || !Objects.equals(a.get(i).action(),b.get(i).action()) || !Objects.equals(a.get(i).expectedResult(),b.get(i).expectedResult()))return false;
        return true;
    }
    private static Context context(ServiceDaos d,Long id) {
        TestAttempt a=d.attempts().findById(id).orElseThrow(()->new NotFoundException("Attempt unavailable"));
        TestRunCase rc=d.runCases().findById(a.testRunCaseId()).orElseThrow(()->new NotFoundException("Run case unavailable"));
        TestRun run=d.testRuns().findById(rc.testRunId()).orElseThrow(()->new NotFoundException("Run unavailable"));return new Context(a,rc,run);
    }
    private static ExecutionEvidence evidence(ServiceDaos d,Context x){var tc=d.testCases().findById(x.runCase().testCaseId()).orElseThrow();var steps=d.runCaseSteps().listByRunCase(x.runCase().id());
        return new ExecutionEvidence(x.attempt(),x.runCase(),x.run(),steps,tc,compatibleCurrent(x.runCase(),steps,tc,d.steps().listByTestCase(tc.id())));}
    private static boolean compatibleCurrent(TestRunCase rc,List<TestRunCaseStep> frozen,TestCase current,List<TestStep> steps) {
        if(!Objects.equals(rc.snapshotTitle(),current.title()) || !Objects.equals(rc.snapshotDescription(),current.description()) || !Objects.equals(rc.snapshotPreconditions(),current.preconditions()))return false;
        return sameSteps(frozen,steps.stream().map(s->new TestRunCaseStep(rc.id(),s.stepOrder(),s.action(),s.expectedResult())).toList());
    }
    private static RetestSelection selection(ServiceDaos d,DefectRetestLink link) {return selection(link,context(d,link.passAttemptId()));}
    private static RetestSelection selection(DefectRetestLink link,Context ctx) {var revoke=link.revocation();
        return new RetestSelection(link.id(),link.failureAttemptId(),link.passAttemptId(),ctx.run().id(),ctx.runCase().id(),link.linkedBy(),link.linkedAt(),link.reviewNote(),link.timingBasis(),revoke==null?null:new RetestSelection.Revocation(revoke.revokedBy(),revoke.revokedAt(),revoke.reason(),revoke.operation()));}
    private static RetestOperationResult operation(ServiceDaos d,DefectRetestLink row,String action,boolean replayed,Graph g) {
        RetestSelection selected=selection(row,g.context(row.passAttemptId()));
        if(action.equals("REVOKE"))return new RetestOperationResult(row.revocation().requestKey(),action,selected,row.revocation().resultDefectVersion(),replayed,null);
        var replaced=d.retestLinks().listByDefectForUpdate(row.defectId()).stream().filter(x->x.revocation()!=null && x.revocation().operation()==DefectRetestRevocationOperation.REPLACE && x.revocation().requestKey().equals(row.requestKey())).findFirst();
        return new RetestOperationResult(row.requestKey(),action,selected,row.resultDefectVersion(),replayed,replaced.map(DefectRetestLink::id).orElse(null));
    }
    private static RetestOperationResult operation(ServiceDaos d,DefectRetestLink row,String action,boolean replayed) {
        if(action.equals("REVOKE"))return new RetestOperationResult(row.revocation().requestKey(),action,selection(d,row),row.revocation().resultDefectVersion(),replayed,null);
        var replaced=d.retestLinks().findReplacedByLinkRequestKey(row.requestKey());return new RetestOperationResult(row.requestKey(),action,selection(d,row),row.resultDefectVersion(),replayed,replaced.map(DefectRetestLink::id).orElse(null));
    }
    private static void replay(DefectRetestLink row,Long actor,Long defect,Sha256Digest hash,boolean revoke) {
        if(!row.defectId().equals(defect) || !(revoke?row.revocation().revokedBy():row.linkedBy()).equals(actor) || !(revoke?row.revocation().requestHash():row.requestHash()).equals(hash))throw rule("REQUEST_KEY_CONFLICT");
    }
    private static Sha256Digest hash(String action,Long actor,Long project,Long defect,Integer version,Long failure,Long pass,Long link,String note,String basis,String reason) {
        try{return new Sha256Digest(MessageDigest.getInstance("SHA-256").digest(JSON.writeValueAsBytes(Arrays.asList("R1_RETEST_COMMAND_V1",action,str(actor),str(project),str(defect),version,str(failure),str(pass),str(link),note,basis,reason))));}
        catch(Exception e){throw new IllegalStateException("R1 command digest unavailable",e);}
    }
    private static String str(Long id){return id==null?null:id.toString();}
    private void writable(ServiceDaos d,Long actor,Long project){var p=d.projects().findByIdForShare(project).orElseThrow(()->new NotFoundException("Project unavailable"));access.requireAssetWrite(d.users(),d.members(),actor,project);if(p.status()!=ProjectStatus.ACTIVE)throw new ConflictException("Archived project is read-only");}
    private static Defect find(ServiceDaos d,Long id){positive(id,"defectId");return d.defects().findById(id).orElseThrow(()->new NotFoundException("Defect unavailable"));}
    private static void mutable(Defect d,Integer version){if(d.status()==DefectStatus.CLOSED)throw rule("CLOSED_READ_ONLY");if(!Objects.equals(d.lockVersion(),version))throw rule("STALE_VERSION");}
    private static void verifySources(Packet p,List<TestAttemptDefect> links){if(!p.failureIds().equals(links.stream().map(TestAttemptDefect::attemptId).sorted().toList()))throw rule("EVIDENCE_CHANGED");}
    private static void requireFailure(Context c){if(c.attempt().status()!=TestAttemptStatus.FAIL)throw rule("NO_FAIL_EVIDENCE");}
    private static Defect bump(ServiceDaos d,Defect current,DefectStatus status){return update(d,new Defect(current.id(),current.projectId(),current.keyNo(),current.title(),current.description(),current.severity(),current.priority(),status,current.reporterId(),current.assigneeId(),current.resolutionNote(),current.createdAt(),current.updatedAt(),current.lockVersion()));}
    private static Defect update(ServiceDaos d,Defect value){try{return d.defects().update(value);}catch(OptimisticLockException e){throw rule("STALE_VERSION");}}
    private static void positive(Long value,String field){if(value==null || value<=0)throw new ValidationException(field+" must be positive");}
    private static void version(Integer value){if(value==null || value<0)throw new ValidationException("expectedVersion must be nonnegative");}
    private static R1RuleException rule(String code){return new R1RuleException(code);}
    private <T> T mutate(ServiceTransaction.Work<T> work) {
        try { return tx.execute(work); }
        catch(DataAccessException e) {
            if(e.getVendorCode()==1062)throw rule("REQUEST_KEY_CONFLICT");
            if(e.getVendorCode()==1213 || e.getVendorCode()==1205)throw rule("CONCURRENT_CHANGE");
            throw e;
        }
    }
    private record Packet(Defect defect,List<Long> failureIds,List<Long> caseIds) { }
    private record Context(TestAttempt attempt,TestRunCase runCase,TestRun run) { }
    private record Graph(Map<Long,TestCase> cases,Map<Long,List<TestStep>> currentSteps,Map<Long,TestRun> runs,
            Map<Long,TestRunCase> runCases,Map<Long,List<TestRunCaseStep>> steps,Map<Long,List<TestAttempt>> history,Map<Long,TestAttempt> attempts) {
        Context context(Long id){var a=attempts.get(id);if(a==null)throw rule("EVIDENCE_CHANGED");var rc=runCases.get(a.testRunCaseId());return new Context(a,rc,runs.get(rc.testRunId()));}
        ExecutionEvidence evidence(Context x){return new ExecutionEvidence(x.attempt(),x.runCase(),x.run(),steps.get(x.runCase().id()),cases.get(x.runCase().testCaseId()),compatibleCurrent(x.runCase()));}
        boolean compatibleCurrent(TestRunCase rc){return DefaultDefectRetestWorkflow.compatibleCurrent(rc,steps.get(rc.id()),cases.get(rc.testCaseId()),currentSteps.get(rc.testCaseId()));}
    }
}
