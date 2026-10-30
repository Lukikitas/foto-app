package app.deliverystar.capture;

import androidx.lifecycle.LiveData;
import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import java.util.List;

@Dao
public interface CaptureDao {
    @Insert(onConflict = OnConflictStrategy.ABORT) void insert(Capture capture);
    @Query("SELECT * FROM captures WHERE id=:id") Capture get(String id);
    @Query("SELECT * FROM captures WHERE state='DRAFT' ORDER BY createdAt LIMIT 1") Capture draft();
    @Query("SELECT * FROM captures WHERE state NOT IN ('SENT','DRAFT') ORDER BY createdAt") List<Capture> pending();
    @Query("SELECT id,state,reviewUntil FROM captures WHERE state NOT IN ('SENT','DRAFT','ERROR') ORDER BY createdAt") List<CaptureWork> pendingWork();
    @Query("SELECT * FROM captures WHERE state='SENT' ORDER BY createdAt DESC LIMIT 100 OFFSET 200") List<Capture> sentToPrune();
    @Query("DELETE FROM captures WHERE id=:id AND state='SENT'") int deleteSent(String id);
    @Query("SELECT * FROM captures ORDER BY createdAt DESC LIMIT 30") LiveData<List<Capture>> observeRecent();
    @Query("SELECT * FROM captures ORDER BY createdAt DESC LIMIT :limit OFFSET :offset") LiveData<List<Capture>> observePage(int limit, int offset);
    @Query("SELECT COUNT(*) FROM captures") LiveData<Integer> observeCount();
    @Query("SELECT COUNT(*) FROM captures WHERE state NOT IN ('SENT','DRAFT')") LiveData<Integer> observePendingCount();
    @Query("UPDATE captures SET evidencePath=:path, state='REVIEW', reviewUntil=:untilAt, error='' WHERE id=:id AND state='DRAFT'") int complete(String id, String path, long untilAt);
    @Query("UPDATE captures SET evidencePath='', state='DRAFT', reviewUntil=0 WHERE id=:id AND state='REVIEW'") int repeat(String id);
    @Query("UPDATE captures SET state='READY', reviewUntil=0 WHERE id=:id AND state='REVIEW'") int commit(String id);
    @Query("UPDATE captures SET state='UPLOADING', error='' WHERE id=:id AND (state IN ('READY','UPLOADING') OR (state='REVIEW' AND reviewUntil<=:now))") int claim(String id, long now);
    @Query("UPDATE captures SET state=:state, error=:error WHERE id=:id") void state(String id, String state, String error);
    @Query("UPDATE captures SET evidenceStored=1 WHERE id=:id") void evidenceStored(String id);
    @Query("UPDATE captures SET photoId=:photoId, displayCode=:code WHERE id=:id") void registered(String id, String photoId, String code);
    @Query("UPDATE captures SET ticketStored=1 WHERE id=:id") void ticketStored(String id);
    @Query("UPDATE captures SET ticketExpired=1 WHERE id=:id") void ticketExpired(String id);
    @Query("UPDATE captures SET ocrText=:text, ocrAttempted=1 WHERE id=:id") void ocr(String id, String text);
    @Query("UPDATE captures SET attempts=attempts+1 WHERE id=:id") void attempt(String id);
    @Query("DELETE FROM captures WHERE id=:id AND state='DRAFT'") int discardDraft(String id);
}
