package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.DefectClosureItemDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.util.*;

/** Append-only. Does not change source evidence or create its referenced PASS. */
public final class JdbcDefectClosureItemDao implements DefectClosureItemDao {
    private final Connection connection;
    public JdbcDefectClosureItemDao(Connection connection){this.connection=Objects.requireNonNull(connection);}
    @Override public DefectClosureItem insert(DefectClosureItem value) {
        Objects.requireNonNull(value);R1Jdbc.transaction(connection);
        try(var s=connection.prepareStatement("INSERT INTO defect_closure_items(receipt_id,failure_attempt_id,defect_id,pass_attempt_id,retest_link_id,evidence_policy) VALUES(?,?,?,?,?,?)")) {
            R1Jdbc.bind(s,value.receiptId(),value.failureAttemptId(),value.defectId(),value.passAttemptId(),value.retestLinkId(),value.evidencePolicy());
            if(s.executeUpdate()!=1)throw new SQLException("Unexpected closure item insert count");
            return value;
        }catch(SQLException e){throw new DataAccessException("Insert closure item",e);}
    }
    @Override public List<DefectClosureItem> listByReceipt(Long id) {
        return query(" WHERE receipt_id=? ORDER BY failure_attempt_id",id);
    }
    @Override public List<DefectClosureItem> listByDefectForShare(Long id) {
        R1Jdbc.transaction(connection);
        return query(" WHERE defect_id=? ORDER BY receipt_id,failure_attempt_id FOR SHARE",id);
    }
    private List<DefectClosureItem> query(String suffix,Long id) {
        try(var s=connection.prepareStatement("SELECT receipt_id,failure_attempt_id,defect_id,pass_attempt_id,retest_link_id,evidence_policy FROM defect_closure_items"+suffix)) {
            R1Jdbc.bind(s,id);
            try(var r=s.executeQuery()) {
                List<DefectClosureItem> result=new ArrayList<>();
                while(r.next())result.add(new DefectClosureItem(r.getObject("receipt_id",Long.class),r.getObject("failure_attempt_id",Long.class),r.getObject("defect_id",Long.class),r.getObject("pass_attempt_id",Long.class),r.getObject("retest_link_id",Long.class),R1Jdbc.enumeration(r,"evidence_policy",DefectClosureEvidencePolicy.class)));
                return List.copyOf(result);
            }
        }catch(SQLException e){throw new DataAccessException("Read closure items",e);}
    }
}
