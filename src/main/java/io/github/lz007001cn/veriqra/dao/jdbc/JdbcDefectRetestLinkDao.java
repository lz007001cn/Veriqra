package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.DefectRetestLinkDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Non-owning connection-scoped persistence only. No permissions/eligibility or implicit retries. */
public final class JdbcDefectRetestLinkDao implements DefectRetestLinkDao {
    private static final String SELECT="SELECT id,defect_id,failure_attempt_id,pass_attempt_id,policy_version,linked_by,linked_at,review_note,timing_basis,request_key,request_hash,result_defect_version,revoked_by,revoked_at,revoke_reason,revocation_operation,revoke_request_key,revoke_request_hash,revoke_result_version FROM defect_retest_links";
    private final Connection connection;
    public JdbcDefectRetestLinkDao(Connection connection){this.connection=Objects.requireNonNull(connection);}
    @Override public DefectRetestLink insert(DefectRetestLink value) {
        Objects.requireNonNull(value);R1Jdbc.transaction(connection);
        if(value.revocation()!=null)throw new IllegalArgumentException("New retest link cannot have a revocation");
        if(!DefectRetestLink.POLICY.equals(value.policyVersion()))throw new IllegalArgumentException("Unknown retest policy");
        Objects.requireNonNull(value.requestKey());Objects.requireNonNull(value.requestHash());
        R1Jdbc.version(value.resultDefectVersion());
        try(var s=connection.prepareStatement("INSERT INTO defect_retest_links(defect_id,failure_attempt_id,pass_attempt_id,policy_version,linked_by,review_note,timing_basis,request_key,request_hash,result_defect_version) VALUES(?,?,?,?,?,?,?,?,?,?)",Statement.RETURN_GENERATED_KEYS)) {
            R1Jdbc.bind(s,value.defectId(),value.failureAttemptId(),value.passAttemptId(),value.policyVersion(),value.linkedBy(),value.reviewNote(),value.timingBasis(),value.requestKey(),value.requestHash(),value.resultDefectVersion());
            long id=R1Jdbc.generated(s);
            return findById(id).orElseThrow(()->new DataAccessException("Inserted retest link could not be read"));
        }catch(SQLException e){throw new DataAccessException("Insert retest link",e);}
    }
    @Override public Optional<DefectRetestLink> findById(Long id){return query(" WHERE id=?",id).stream().findFirst();}
    @Override public Optional<DefectRetestLink> findByIdForUpdate(Long id){R1Jdbc.transaction(connection);return query(" WHERE id=? FOR UPDATE",id).stream().findFirst();}
    @Override public Optional<DefectRetestLink> findByLinkRequestKey(UUID key){return query(" WHERE request_key=?",key).stream().findFirst();}
    @Override public Optional<DefectRetestLink> findByRevokeRequestKey(UUID key){return query(" WHERE revoke_request_key=? AND revocation_operation='REVOKE'",key).stream().findFirst();}
    @Override public Optional<DefectRetestLink> findReplacedByLinkRequestKey(UUID key){return query(" WHERE revoke_request_key=? AND revocation_operation='REPLACE'",key).stream().findFirst();}
    @Override public List<DefectRetestLink> listByRequestKeyForUpdate(UUID key) {
        R1Jdbc.transaction(connection);Objects.requireNonNull(key);
        Map<Long,DefectRetestLink> rows=new LinkedHashMap<>();
        for(var row:query(" WHERE request_key=? FOR UPDATE",key))rows.put(row.id(),row);
        for(var row:query(" WHERE revoke_request_key=? FOR UPDATE",key))rows.put(row.id(),row);
        return List.copyOf(rows.values());
    }
    @Override public List<DefectRetestLink> listByDefect(Long id){return query(" WHERE defect_id=? ORDER BY failure_attempt_id,id",id);}
    @Override public List<DefectRetestLink> listByDefectForUpdate(Long id){R1Jdbc.transaction(connection);return query(" WHERE defect_id=? ORDER BY failure_attempt_id,id FOR UPDATE",id);}
    @Override public Optional<DefectRetestLink> findActive(Long defect,Long failure){return query(" WHERE defect_id=? AND active_failure_id=?",defect,failure).stream().findFirst();}
    @Override public boolean revoke(Long id,Long defect,DefectRetestRevocation value) {
        Objects.requireNonNull(value);R1Jdbc.transaction(connection);
        if(value.revokedAt()!=null)throw new IllegalArgumentException("Revocation time is database-generated");
        Objects.requireNonNull(value.requestKey());Objects.requireNonNull(value.requestHash());
        Objects.requireNonNull(value.operation());R1Jdbc.version(value.resultDefectVersion());
        try(var s=connection.prepareStatement("UPDATE defect_retest_links SET revoked_by=?,revoked_at=CURRENT_TIMESTAMP(6),revoke_reason=?,revocation_operation=?,revoke_request_key=?,revoke_request_hash=?,revoke_result_version=? WHERE id=? AND defect_id=? AND revoked_at IS NULL")) {
            R1Jdbc.bind(s,value.revokedBy(),value.reason(),value.operation(),value.requestKey(),value.requestHash(),value.resultDefectVersion(),id,defect);
            int count=s.executeUpdate();
            if(count>1)throw new SQLException("Unexpected retest revocation count");
            return count==1;
        }catch(SQLException e){throw new DataAccessException("Revoke retest link",e);}
    }
    private List<DefectRetestLink> query(String suffix,Object... values) {
        try(var s=connection.prepareStatement(SELECT+suffix)) {
            R1Jdbc.bind(s,values);
            try(var r=s.executeQuery()){List<DefectRetestLink> result=new ArrayList<>();while(r.next())result.add(map(r));return List.copyOf(result);}
        }catch(SQLException e){throw new DataAccessException("Read retest link",e);}
    }
    private static DefectRetestLink map(ResultSet r)throws SQLException {
        LocalDateTime at=r.getObject("revoked_at",LocalDateTime.class);
        DefectRetestRevocation revocation=at==null?null:new DefectRetestRevocation(r.getObject("revoked_by",Long.class),at,r.getString("revoke_reason"),
                R1Jdbc.enumeration(r,"revocation_operation",DefectRetestRevocationOperation.class),R1Jdbc.uuid(r,"revoke_request_key"),R1Jdbc.hash(r,"revoke_request_hash"),r.getObject("revoke_result_version",Integer.class));
        return new DefectRetestLink(r.getObject("id",Long.class),r.getObject("defect_id",Long.class),r.getObject("failure_attempt_id",Long.class),r.getObject("pass_attempt_id",Long.class),r.getString("policy_version"),r.getObject("linked_by",Long.class),r.getObject("linked_at",LocalDateTime.class),r.getString("review_note"),
                R1Jdbc.enumeration(r,"timing_basis",DefectRetestTimingBasis.class),R1Jdbc.uuid(r,"request_key"),R1Jdbc.hash(r,"request_hash"),r.getObject("result_defect_version",Integer.class),revocation);
    }
}
