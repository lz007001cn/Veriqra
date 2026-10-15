package io.github.lz007001cn.veriqra.model;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class DefectRetestModelTest {
    @Test void nestedBinaryFactsPreserveRecordValueSemantics() {
        UUID key=UUID.randomUUID();
        var a=link(key,new Sha256Digest(new byte[32]));var b=link(key,new Sha256Digest(new byte[32]));
        assertEquals(a,b);assertEquals(a.hashCode(),b.hashCode());
        byte[] bytes=a.requestHash().bytes();bytes[0]=7;assertEquals(a,b);
        var r1=new DefectRetestRevocation(1L,LocalDateTime.of(2026,10,14,1,0),"reason",DefectRetestRevocationOperation.REVOKE,key,new Sha256Digest(new byte[32]),4);
        var r2=new DefectRetestRevocation(1L,r1.revokedAt(),"reason",r1.operation(),key,new Sha256Digest(new byte[32]),4);
        assertEquals(r1,r2);assertEquals(r1.hashCode(),r2.hashCode());
    }
    @Test void closureFactsHaveSeparatePoliciesAndNoMutableContainer() {
        var item=new DefectClosureItem(1L,2L,3L,4L,null,DefectClosureEvidencePolicy.SAME_RUN_CASE_V1);
        assertEquals(item,new DefectClosureItem(1L,2L,3L,4L,null,DefectClosureEvidencePolicy.SAME_RUN_CASE_V1));
        assertNotEquals(item,new DefectClosureItem(1L,2L,3L,4L,5L,DefectClosureEvidencePolicy.EXACT_SEMANTIC_V1));
        var receipt=new DefectClosureReceipt(1L,3L,6,7L,null,DefectClosureReceipt.POLICY,"original close note",1);
        assertEquals("original close note",receipt.resolutionNote());
    }
    private DefectRetestLink link(UUID key,Sha256Digest hash) {
        return new DefectRetestLink(1L,2L,3L,4L,DefectRetestLink.POLICY,5L,null,"review",DefectRetestTimingBasis.MANUAL_SERVER_RECORD,key,hash,6,null);
    }
}
