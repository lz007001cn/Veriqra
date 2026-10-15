package io.github.lz007001cn.veriqra.model;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class Sha256DigestTest {
    @Test void rejectsNullAndNonSha256Widths() {
        assertThrows(NullPointerException.class,()->new Sha256Digest(null));
        for(int n:new int[]{0,16,31,33,64})assertThrows(IllegalArgumentException.class,()->new Sha256Digest(new byte[n]));
    }
    @Test void constructorAndAccessorCannotMutateStoredDigest() {
        byte[] input=new byte[32];input[0]=12;var digest=new Sha256Digest(input);
        input[0]=99;byte[] output=digest.bytes();output[0]=33;
        assertEquals(12,digest.bytes()[0]);
    }
    @Test void binaryValueEqualityAndHashCodeAreStable() {
        var a=new Sha256Digest(new byte[32]);var b=new Sha256Digest(new byte[32]);
        assertEquals(a,b);assertEquals(a.hashCode(),b.hashCode());
        byte[] other=new byte[32];other[31]=1;assertNotEquals(a,new Sha256Digest(other));
        assertNotEquals(a,null);assertNotEquals(a,new byte[32]);
    }
}
