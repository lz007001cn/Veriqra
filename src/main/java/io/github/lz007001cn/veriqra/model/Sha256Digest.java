package io.github.lz007001cn.veriqra.model;

import java.util.Arrays;
import java.util.Objects;

/** Fixed-width immutable binary value; JDBC BINARY padding must not hide malformed input. */
public final class Sha256Digest {
    private final byte[] bytes;
    public Sha256Digest(byte[] value) {
        Objects.requireNonNull(value,"SHA-256 bytes");
        if(value.length!=32)throw new IllegalArgumentException("SHA-256 requires exactly 32 bytes");
        bytes=value.clone();
    }
    public byte[] bytes(){return bytes.clone();}
    @Override public boolean equals(Object other){return other instanceof Sha256Digest value && Arrays.equals(bytes,value.bytes);}
    @Override public int hashCode(){return Arrays.hashCode(bytes);}
    @Override public String toString(){return "SHA-256[32 bytes]";}
}
