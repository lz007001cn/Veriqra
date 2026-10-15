package io.github.lz007001cn.veriqra.dao;
import io.github.lz007001cn.veriqra.model.DefectClosureItem;
import java.util.List;

/** Append-only evidence. No update/delete operation and no implicit creation of Attempts. */
public interface DefectClosureItemDao {
    DefectClosureItem insert(DefectClosureItem value);
    List<DefectClosureItem> listByReceipt(Long receiptId);
    /** Current read after the common Case and Defect locks; retained source deletion guard. */
    List<DefectClosureItem> listByDefectForShare(Long defectId);
}
