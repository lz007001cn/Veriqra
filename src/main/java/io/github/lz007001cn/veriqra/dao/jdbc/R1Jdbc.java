package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.Sha256Digest;
import java.nio.ByteBuffer;
import java.sql.*;
import java.util.*;

/** Shared only by the R1 foundation DAOs; no transaction lifecycle or business rules. */
final class R1Jdbc {
    private R1Jdbc() { }
    static void transaction(Connection c) {
        try{if(c.getAutoCommit())throw new SQLException("R1 writes/locking require an outer transaction","25000");}
        catch(SQLException e){throw new DataAccessException("R1 transaction guard",e);}
    }
    static byte[] uuid(UUID key){return key==null?null:ByteBuffer.allocate(16).putLong(key.getMostSignificantBits()).putLong(key.getLeastSignificantBits()).array();}
    static UUID uuid(ResultSet r,String column)throws SQLException {
        byte[] bytes=r.getBytes(column);
        if(bytes==null)return null;
        if(bytes.length!=16)throw new SQLException("Invalid R1 UUID width","22000");
        ByteBuffer b=ByteBuffer.wrap(bytes);return new UUID(b.getLong(),b.getLong());
    }
    static Sha256Digest hash(ResultSet r,String column)throws SQLException {
        byte[] bytes=r.getBytes(column);
        if(bytes==null)return null;
        if(bytes.length!=32)throw new SQLException("Invalid R1 hash width","22000");
        return new Sha256Digest(bytes);
    }
    static void bind(PreparedStatement s,Object... values)throws SQLException {
        for(int i=0;i<values.length;i++) {
            Object v=values[i];
            if(v instanceof UUID key)s.setBytes(i+1,uuid(key));
            else if(v instanceof Sha256Digest digest)s.setBytes(i+1,digest.bytes());
            else if(v instanceof Enum<?> e)s.setString(i+1,e.name());
            else s.setObject(i+1,v);
        }
    }
    static long generated(PreparedStatement s)throws SQLException {
        if(s.executeUpdate()!=1)throw new SQLException("Unexpected R1 insert count");
        try(var keys=s.getGeneratedKeys()){if(!keys.next())throw new SQLException("Missing R1 generated ID");return keys.getLong(1);}
    }
    static void version(Integer value){if(value==null || value<0)throw new IllegalArgumentException("Nonnegative Defect version required");}
    static <T extends Enum<T>> T enumeration(ResultSet r,String column,Class<T> type)throws SQLException {
        try{return Enum.valueOf(type,r.getString(column));}
        catch(IllegalArgumentException|NullPointerException e){throw new SQLException("Invalid R1 stored enum","22000",e);}
    }
}
