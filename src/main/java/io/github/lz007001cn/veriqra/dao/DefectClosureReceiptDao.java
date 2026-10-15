package io.github.lz007001cn.veriqra.dao;
import io.github.lz007001cn.veriqra.model.DefectClosureReceipt;
import java.util.*;

/** Append-only, non-owning DAO. Caller atomically updates Defect and inserts all receipt items. */
public interface DefectClosureReceiptDao {
    DefectClosureReceipt insert(DefectClosureReceipt value);
    Optional<DefectClosureReceipt> findById(Long id);
    List<DefectClosureReceipt> listByDefect(Long defectId);
}
