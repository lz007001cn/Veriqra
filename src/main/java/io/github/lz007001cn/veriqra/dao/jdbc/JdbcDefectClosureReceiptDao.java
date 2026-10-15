package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.DefectClosureReceiptDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.DefectClosureReceipt;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Append-only; caller owns atomic close/state/items transaction and all business validation. */
public final class JdbcDefectClosureReceiptDao implements DefectClosureReceiptDao {
    private static final String SELECT="SELECT id,defect_id,closed_defect_version,closed_by,closed_at,policy_version,resolution_note,evidence_count FROM defect_closure_receipts";
    private final Connection connection;
    public JdbcDefectClosureReceiptDao(Connection connection){this.connection=Objects.requireNonNull(connection);}
    @Override public DefectClosureReceipt insert(DefectClosureReceipt value) {
        Objects.requireNonNull(value);R1Jdbc.transaction(connection);
        if(!DefectClosureReceipt.POLICY.equals(value.policyVersion()))throw new IllegalArgumentException("Unknown closure policy");
        R1Jdbc.version(value.closedDefectVersion());
        try(var s=connection.prepareStatement("INSERT INTO defect_closure_receipts(defect_id,closed_defect_version,closed_by,policy_version,resolution_note,evidence_count) VALUES(?,?,?,?,?,?)",Statement.RETURN_GENERATED_KEYS)) {
            R1Jdbc.bind(s,value.defectId(),value.closedDefectVersion(),value.closedBy(),value.policyVersion(),value.resolutionNote(),value.evidenceCount());
            long id=R1Jdbc.generated(s);return findById(id).orElseThrow(()->new DataAccessException("Inserted closure receipt could not be read"));
        }catch(SQLException e){throw new DataAccessException("Insert closure receipt",e);}
    }
    @Override public Optional<DefectClosureReceipt> findById(Long id){return query(" WHERE id=?",id).stream().findFirst();}
    @Override public List<DefectClosureReceipt> listByDefect(Long id){return query(" WHERE defect_id=? ORDER BY closed_defect_version,id",id);}
    private List<DefectClosureReceipt> query(String suffix,Long id) {
        try(var s=connection.prepareStatement(SELECT+suffix)) {
            R1Jdbc.bind(s,id);
            try(var r=s.executeQuery()){
                List<DefectClosureReceipt> result=new ArrayList<>();
                while(r.next())result.add(new DefectClosureReceipt(r.getObject("id",Long.class),r.getObject("defect_id",Long.class),r.getObject("closed_defect_version",Integer.class),r.getObject("closed_by",Long.class),r.getObject("closed_at",LocalDateTime.class),r.getString("policy_version"),r.getString("resolution_note"),r.getObject("evidence_count",Integer.class)));
                return List.copyOf(result);
            }
        }catch(SQLException e){throw new DataAccessException("Read closure receipt",e);}
    }
}
