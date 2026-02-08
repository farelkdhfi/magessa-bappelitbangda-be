const { supabase } = require("../../config/supabase");
const { generateFileUrl, transformFeedbackData } = require("../../utils/fileHandler");
const { uploadToSupabaseStorage } = require("../../utils/uploadSupabase");

const getKepalaFeedback = async (req, res) => {
    try {
        console.log('--- DEBUG KEPALA FEEDBACK ---');
        console.log('User Role:', req.user.role);
        // Hanya kepala dan admin yang bisa akses
        if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        const { data: feedback, error, count } = await supabase
            .from('feedback_disposisi')
            .select(`
            *,
            disposisi (
              id,
              perihal,
              sifat,
              diteruskan_kepada_jabatan,
              dengan_hormat_harap,
              created_by
            ),
            users (name),
            surat_masuk (
              id,
              nomor_surat,
              asal_instansi,
              tanggal_surat,
              diterima_tanggal,
              nomor_agenda
            ),
            feedback_files (
              id,
              file_original_name,
              file_size,
              file_type,
              file_path,
              storage_path
            )
          `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching feedback for kepala:', error);
            return res.status(400).json({ error: error.message });
        }
        console.log('Jumlah Data ditemukan di DB:', feedback ? feedback.length : 0);

        // Transform data dengan file info
        const transformedData = feedback?.map(item => {
            const files = item.feedback_files?.map(file => {
                let fileUrl = `/api/kepala/feedback/file/${file.id}`;

                // Jika file_path sudah berupa URL lengkap, gunakan langsung
                if (file.file_path && file.file_path.startsWith('http')) {
                    fileUrl = file.file_path;
                } else if (file.storage_path) {
                    // Generate public URL dari Supabase
                    const { data: { publicUrl } } = supabase.storage
                        .from('surat-photos')
                        .getPublicUrl(file.storage_path);
                    fileUrl = publicUrl;
                }

                return {
                    id: file.id,
                    filename: file.file_original_name,
                    size: file.file_size,
                    type: file.file_type,
                    url: fileUrl
                };
            }) || [];

            return {
                ...item,
                files,
                file_count: files.length,
                has_files: files.length > 0
            };
        }) || [];

        res.json({
            message: 'Berhasil mengambil semua feedback',
            data: transformedData,
            total: transformedData.length
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
}

const getKepalaDetailFeedback = async (req, res) => {
    try {
        const { id } = req.params;

        // Hanya kepala dan admin yang bisa akses
        if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        const { data: feedback, error } = await supabase
            .from('feedback_disposisi')
            .select(`
            *,
            disposisi (
              id,
              perihal,
              sifat,
              diteruskan_kepada_jabatan,
              dengan_hormat_harap,
              nomor_surat,
              asal_instansi,
              tanggal_surat,
              diterima_tanggal,
              nomor_agenda,
              created_by
            ),
            surat_masuk (
              id,
              nomor_surat,
              asal_instansi,
              tanggal_surat,
              keterangan,
              diterima_tanggal,
              nomor_agenda
            ),
            feedback_files (
              id,
              file_original_name,
              file_size,
              file_type,
              file_path,
              storage_path
            )
          `)
            .eq('id', id)
            .single();

        if (error || !feedback) {
            return res.status(404).json({ error: 'Feedback tidak ditemukan' });
        }

        // Transform file data
        const files = feedback.feedback_files?.map(file => {
            let fileUrl = `/api/v1/feedback/kepala/${file.id}`;

            if (file.file_path && file.file_path.startsWith('http')) {
                fileUrl = file.file_path;
            } else if (file.storage_path) {
                const { data: { publicUrl } } = supabase.storage
                    .from('surat-photos')
                    .getPublicUrl(file.storage_path);
                fileUrl = publicUrl;
            }

            return {
                id: file.id,
                filename: file.file_original_name,
                size: file.file_size,
                type: file.file_type,
                url: fileUrl
            };
        }) || [];

        res.json({
            ...feedback,
            files,
            file_count: files.length,
            has_files: files.length > 0
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const getKepalaFileFeedback = async (req, res) => {
    try {
        const { fileId } = req.params;

        // Hanya kepala dan admin yang bisa akses
        if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        console.log('Kepala feedback file request for ID:', fileId);

        const { data: file, error } = await supabase
            .from('feedback_files')
            .select('*')
            .eq('id', fileId)
            .single();

        if (error) {
            console.error('Database error:', error);
            return res.status(404).json({ error: 'File tidak ditemukan: ' + error.message });
        }

        if (!file) {
            return res.status(404).json({ error: 'File tidak ditemukan' });
        }

        console.log('File data from DB:', file);

        // Prioritas 1: Jika file_path sudah berupa URL lengkap, redirect langsung
        if (file.file_path && file.file_path.startsWith('http')) {
            console.log('Redirecting to existing URL:', file.file_path);
            return res.redirect(file.file_path);
        }

        // Prioritas 2: Generate public URL dari storage_path
        if (file.storage_path) {
            try {
                const { data: { publicUrl }, error: urlError } = supabase.storage
                    .from('surat-photos')
                    .getPublicUrl(file.storage_path);

                if (urlError) {
                    console.error('Error generating public URL:', urlError);
                } else {
                    console.log('Generated public URL:', publicUrl);
                    return res.redirect(publicUrl);
                }
            } catch (urlGenError) {
                console.error('Error in URL generation:', urlGenError);
            }
        }

        // Jika semua gagal
        console.error('All methods failed. File data:', file);
        return res.status(404).json({
            error: 'File tidak dapat diakses',
            debug: {
                fileId,
                file_path: file.file_path,
                storage_path: file.storage_path
            }
        });

    } catch (error) {
        console.error('Server error in kepala feedback file endpoint:', error);
        res.status(500).json({ error: error.message });
    }
}

const getAtasanFileFeedback = async (req, res) => {
    try {
        const { fileId } = req.params;
        const userId = req.user.id;

        // Get file with ownership check
        const { data: file, error } = await supabase
            .from('feedback_files')
            .select(`
        *,
        feedback_disposisi!inner (user_id)
      `)
            .eq('id', fileId)
            .eq('feedback_disposisi.user_id', userId)
            .single();

        if (error || !file) {
            return res.status(404).json({ error: 'File tidak ditemukan' });
        }

        // Generate URL dan redirect
        const fileUrl = generateFileUrl(file);

        if (fileUrl.startsWith('http')) {
            return res.redirect(fileUrl);
        }

        return res.status(404).json({ error: 'File tidak dapat diakses' });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
}

const deleteFileFeedback = async (req, res) => {
    try {
        const { fileId } = req.params;
        const userId = req.user.id;

        console.log('Delete feedback file request for ID:', fileId);

        // Pastikan file milik user yang request
        const { data: file, error } = await supabase
            .from('feedback_files')
            .select(`
            *,
            feedback_disposisi!inner (
              user_id,
              user_jabatan
            )
          `)
            .eq('id', fileId)
            .eq('feedback_disposisi.user_id', userId)
            .single();

        if (error || !file) {
            return res.status(404).json({
                error: 'File tidak ditemukan atau tidak ada akses untuk menghapus'
            });
        }

        // Hapus dari storage jika ada storage_path
        if (file.storage_path) {
            const { error: storageError } = await supabase.storage
                .from('surat-photos')
                .remove([file.storage_path]);

            if (storageError) {
                console.error('Error removing file from storage:', storageError);
            } else {
                console.log('File removed from storage:', file.storage_path);
            }
        }

        // Hapus dari database
        const { error: deleteError } = await supabase
            .from('feedback_files')
            .delete()
            .eq('id', fileId);

        if (deleteError) {
            console.error('Error deleting file from database:', deleteError);
            return res.status(500).json({ error: 'Gagal menghapus file dari database' });
        }

        res.json({
            message: 'File feedback berhasil dihapus',
            data: {
                deleted_file_id: fileId,
                deleted_filename: file.file_original_name
            }
        });

    } catch (error) {
        console.error('Server error in file deletion:', error);
        res.status(500).json({ error: error.message });
    }
}

const getAtasanFeedback = async (req, res) => {
    try {
        const { role } = req.params;
        const userId = req.user.id;

        // Validasi role
        if (!['user', 'sekretaris'].includes(role)) {
            return res.status(400).json({ error: 'Role tidak valid' });
        }

        const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

        const { data: feedback, error } = await supabase
            .from('feedback_disposisi')
            .select(`
            *,
            disposisi (
              id,
              perihal,
              sifat,
              dengan_hormat_harap,
              status,
              ${statusField},
              created_at
            ),
            feedback_files (
              id,
              file_original_name,
              file_size,
              file_type,
              file_path,
              storage_path
            )
          `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error(`Error fetching ${role} feedback:`, error);
            return res.status(400).json({ error: error.message });
        }

        const transformedData = transformFeedbackData(feedback);

        res.json({
            message: `Berhasil mengambil feedback ${role}`,
            data: transformedData,
            total: transformedData.length
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
}

const buatAtasanFeedback = async (req, res) => {
    try {
        const { role } = req.params;
        const { disposisiId } = req.params;
        const { notes, status } = req.body; // Tambahkan status dari request body

        // --- PERBAIKAN: Ambil User & Join ke Tabel Jabatan ---
        // Kita perlu nama jabatan ("Sekretaris") bukan ID-nya
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`
                name,
                jabatan_id,
                jabatan:jabatan_id ( nama )
            `)
            .eq('id', req.user.id)
            .single();

        if (userError || !userData) {
            console.error('Error fetch user data:', userError);
            return res.status(401).json({ error: 'Data user tidak ditemukan' });
        }

        // Ambil string nama jabatan dari hasil join
        // Jika relasi gagal atau null, fallback ke manual check nanti
        const userJabatan = userData.jabatan?.nama;
        const userName = userData.name;

        // Validasi Jabatan
        if (!userJabatan) {
            console.error('Jabatan user kosong/tidak valid. User ID:', req.user.id);
            return res.status(400).json({ error: 'Data jabatan user tidak valid atau tidak ditemukan' });
        }
        // -----------------------------------------------------

        if (!['user', 'sekretaris'].includes(role)) {
            return res.status(400).json({ error: 'Role tidak valid' });
        }

        const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

        // Validasi input
        if (!notes || notes.trim() === '') {
            return res.status(400).json({
                error: 'Notes/catatan feedback wajib diisi'
            });
        }

        if (!status || !['diproses', 'selesai'].includes(status)) {
            return res.status(400).json({
                error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
            });
        }

        // Pastikan disposisi ada dan ditujukan ke jabatan user
        const { data: disposisi, error: disposisiError } = await supabase
            .from('disposisi')
            .select(`id, disposisi_kepada_jabatan, perihal, created_by, surat_masuk_id, status, ${statusField}`)
            .eq('id', disposisiId)
            .eq('disposisi_kepada_jabatan', userJabatan) // Sekarang userJabatan sudah benar ("Sekretaris")
            .single();

        if (disposisiError || !disposisi) {
            console.error('Disposisi Not Found Debug:', { disposisiId, userJabatan, error: disposisiError });
            return res.status(404).json({
                error: 'Disposisi tidak ditemukan atau tidak ditujukan untuk jabatan Anda'
            });
        }

        // Cek apakah feedback sudah ada sebelumnya
        const { data: existingFeedback, error: checkError } = await supabase
            .from('feedback_disposisi')
            .select('id')
            .eq('disposisi_id', disposisiId)
            .single();

        if (existingFeedback) {
            return res.status(400).json({
                error: 'Feedback untuk disposisi ini sudah dikirim sebelumnya'
            });
        }

        // Data feedback
        const feedbackData = {
            disposisi_id: disposisiId,
            surat_masuk_id: disposisi.surat_masuk_id,
            user_id: req.user.id,
            user_jabatan: userJabatan,
            user_name: userName,
            notes: notes.trim(),
            created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        };

        // Insert feedback
        const { data: feedbackResult, error: feedbackError } = await supabase
            .from('feedback_disposisi')
            .insert([feedbackData])
            .select()
            .single();

        if (feedbackError) {
            console.error('Error creating feedback:', feedbackError);
            return res.status(400).json({ error: feedbackError.message });
        }

        console.log('Feedback berhasil dibuat:', feedbackResult);

        // Upload files jika ada
        let fileCount = 0;
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(file =>
                uploadToSupabaseStorage(file, 'feedback-disposisi', 'surat-photos')
            );

            try {
                const uploadResults = await Promise.all(uploadPromises);

                // Simpan data file ke database
                const fileData = uploadResults.map(result => ({
                    feedback_id: feedbackResult.id,
                    disposisi_id: disposisiId,
                    file_path: result.publicUrl,
                    file_filename: result.fileName,
                    file_original_name: result.originalName,
                    file_size: result.size,
                    file_type: result.mimetype,
                    storage_path: result.fileName,
                    created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
                }));

                const { error: fileError } = await supabase
                    .from('feedback_files')
                    .insert(fileData);

                if (fileError) {
                    // Rollback: hapus feedback dan files dari storage
                    await supabase.from('feedback_disposisi').delete().eq('id', feedbackResult.id);

                    // Hapus files dari Supabase Storage
                    const filesToDelete = uploadResults.map(r => r.fileName);
                    await supabase.storage.from('surat-photos').remove(filesToDelete);

                    return res.status(400).json({ error: 'Gagal menyimpan file: ' + fileError.message });
                }

                fileCount = req.files.length;
                console.log(`${fileCount} files uploaded successfully`);
            } catch (uploadError) {
                console.error('Upload error:', uploadError);
                // Rollback feedback jika upload gagal
                await supabase.from('feedback_disposisi').delete().eq('id', feedbackResult.id);
                return res.status(400).json({ error: 'Gagal upload file: ' + uploadError.message });
            }
        }

        // Update status disposisi dan has_feedback
        const { error: updateError } = await supabase
            .from('disposisi')
            .update(
                {
                    has_feedback: true,
                    status: status,
                    [statusField]: status
                }
            )
            .eq('id', disposisiId);

        if (updateError) {
            console.error('Error updating disposisi status:', updateError);
            return res.status(500).json({ error: 'Gagal memperbarui status disposisi' });
        }

        console.log('Status disposisi diupdate menjadi:', status);

        // 🔧 TAMBAHAN: Insert ke disposisi_status_log
        const statusLogData = {
            disposisi_id: disposisiId,
            status: status, // status yang dikirimkan adalah 'diproses' atau 'selesai'
            oleh_user_id: req.user.id,
            keterangan: `Disposisi ${status} melalui feedback oleh ${userJabatan}`
        };

        const { error: logError } = await supabase
            .from('disposisi_status_log')
            .insert([statusLogData]);

        if (logError) {
            console.error('Error creating status log:', logError);
            // Tidak throw error karena feedback sudah berhasil dibuat
        }

        res.status(201).json({
            message: `Feedback berhasil dikirim dan status disposisi diupdate menjadi "${status}"`,
            data: {
                ...feedbackResult,
                status_disposisi: status,
                file_count: fileCount,
                has_files: fileCount > 0
            }
        });

    } catch (error) {
        console.error('Server error in feedback creation:', error);
        res.status(500).json({ error: error.message });
    }
}

const getAtasanFeedbackDariBawahan = async (req, res) => {
    try {
        const { role } = req.params;
        const { disposisiId } = req.params;

        if (!['user', 'sekretaris'].includes(role)) {
            return res.status(400).json({ error: 'Role tidak valid' });
        }

        const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

        // ✅ Role check - hanya untuk Kabid
        if (req.user.role !== 'user' && req.user.role !== 'sekretaris') { // Sesuaikan dengan role Kabid Anda
            return res.status(403).json({ error: 'Hanya Sekretaris dan Kabid yang bisa mengakses feedback bawahan' });
        }

        // Ambil disposisi untuk mendapatkan diteruskan_kepada_user_id
        const { data: disposisi, error: disposisiError } = await supabase
            .from('disposisi')
            .select('id, diteruskan_kepada_user_id, diteruskan_kepada_jabatan, diteruskan_kepada_nama, status, status_dari_bawahan')
            .eq('id', disposisiId)
            .single();

        if (disposisiError || !disposisi) {
            return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
        }



        // Pastikan disposisi ini diteruskan ke seseorang (bukan null)
        if (!disposisi.diteruskan_kepada_user_id) {
            // Opsional: return empty jika belum ada penerima
            return res.status(404).json({ error: 'Disposisi belum diteruskan ke bawahan' });
        }

        // Ambil feedback dari bawahan (user_id = diteruskan_kepada_user_id)
        const { data: feedback, error: feedbackError } = await supabase
            .from('feedback_disposisi')
            .select(`
        *,
        disposisi (
          id,
          perihal,
          sifat,
          diteruskan_kepada_jabatan,
          dengan_hormat_harap,
          nomor_surat,
          asal_instansi,
          tanggal_surat,
          diterima_tanggal,
          nomor_agenda,
          created_by,
          status
        ),
        surat_masuk (
          id,
          nomor_surat,
          asal_instansi,
          tanggal_surat,
          keterangan,
          diterima_tanggal,
          nomor_agenda
        ),
        feedback_files (
          id,
          file_original_name,
          file_size,
          file_type,
          file_path,
          storage_path
        )
      `)
            .eq('disposisi_id', disposisiId)
            .eq('user_id', disposisi.diteruskan_kepada_user_id) // Filter berdasarkan user bawahan
            .single(); // Karena diasumsikan hanya satu feedback per disposisi per user

        if (feedbackError) {
            console.error('Error fetching bawahan feedback:', feedbackError);
            // Jika tidak ditemukan, kirim 404
            if (feedbackError.code === 'PGRST116') { // Kode untuk single() not found
                return res.status(404).json({ error: 'Feedback dari bawahan belum diterima' });
            }
            return res.status(500).json({ error: feedbackError.message });
        }

        if (!feedback) {
            return res.status(404).json({ error: 'Feedback dari bawahan belum diterima' });
        }

        const files = feedback.feedback_files?.map(file => {
            let fileUrl = `/api/feedback/file/${file.id}`;

            if (file.file_path && file.file_path.startsWith('http')) {
                fileUrl = file.file_path;
            } else if (file.storage_path) {
                const { data: { publicUrl } } = supabase.storage
                    .from('surat-photos')
                    .getPublicUrl(file.storage_path);
                fileUrl = publicUrl;
            }

            return {
                id: file.id,
                filename: file.file_original_name,
                size: file.file_size,
                type: file.file_type,
                url: fileUrl
            };
        }) || [];

        res.json({
            ...feedback,
            files,
            file_count: files.length,
            has_files: files.length > 0
        });

    } catch (error) {
        console.error('Server error in fetching bawahan feedback:', error);
        res.status(500).json({ error: error.message });
    }
}

const getEditFeedbackAtasan = async (req, res) => {
    try {
        const { role } = req.params;
        const { feedbackId } = req.params;
        const userId = req.user.id;

        // --- FIX: Ambil Data User & Join Jabatan ---
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`name, jabatan_id, jabatan:jabatan_id ( nama )`)
            .eq('id', userId)
            .single();

        if (userError || !userData) {
            return res.status(401).json({ error: 'Data user tidak ditemukan' });
        }

        const userJabatan = userData.jabatan?.nama; // "Sekretaris"
        // ------------------------------------------

        if (!['user', 'sekretaris'].includes(role)) {
            return res.status(400).json({ error: 'Role tidak valid' });
        }

        const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

        // Ambil detail feedback dengan validasi kepemilikan
        const { data: feedback, error } = await supabase
            .from('feedback_disposisi')
            .select(`
                *,
                disposisi (
                    id,
                    perihal,
                    sifat,
                    disposisi_kepada_jabatan,
                    dengan_hormat_harap,
                    created_at,
                    status,
                    ${statusField},
                    surat_masuk (
                        id,
                        keterangan
                    )
                ),
                feedback_files (
                    id,
                    file_original_name,
                    file_size,
                    file_type,
                    file_path,
                    storage_path
                )
            `)
            .eq('id', feedbackId)
            .eq('user_id', userId)
            .eq('user_jabatan', userJabatan) // Menggunakan string jabatan yang benar
            .single();

        if (error || !feedback) {
            return res.status(404).json({
                error: 'Feedback tidak ditemukan atau tidak ada akses untuk mengedit'
            });
        }

        // Transform file data
        const transformedData = transformFeedbackData(feedback ? [feedback] : [])[0];

        res.json({
            message: 'Berhasil mengambil detail feedback untuk edit',
            data: transformedData,
            total: transformedData.length
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
}

const editFeedbackAtasan = async (req, res) => {
    try {
        const { role } = req.params;
        const { feedbackId } = req.params;
        const { notes, status, remove_file_ids } = req.body;
        const userId = req.user.id;

        // --- FIX: Ambil Data User & Join Jabatan ---
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`name, jabatan_id, jabatan:jabatan_id ( nama )`)
            .eq('id', userId)
            .single();

        if (userError || !userData) {
            return res.status(401).json({ error: 'Data user tidak ditemukan' });
        }

        const userJabatan = userData.jabatan?.nama; // "Sekretaris"
        // ------------------------------------------

        const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

        console.log('Edit feedback request:', {
            feedbackId,
            userJabatan, // Log untuk memastikan
            status,
            statusField
        });

        // Validasi input - sama seperti di create feedback
        if (!notes || notes.trim() === '') {
            return res.status(400).json({
                error: 'Notes/catatan feedback wajib diisi'
            });
        }

        if (!status || !['diproses', 'selesai'].includes(status)) {
            return res.status(400).json({
                error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
            });
        }

        // Pastikan feedback ada dan milik user
        const { data: existingFeedback, error: feedbackError } = await supabase
            .from('feedback_disposisi')
            .select(`
                *,
                disposisi (
                    id,
                    perihal,
                    created_by,
                    surat_masuk_id,
                    disposisi_kepada_jabatan,
                    status,
                    ${statusField}
                )
            `)
            .eq('id', feedbackId)
            .eq('user_id', userId)
            .eq('user_jabatan', userJabatan) // Validasi jabatan string
            .single();

        if (feedbackError || !existingFeedback) {
            return res.status(404).json({
                error: 'Feedback tidak ditemukan atau tidak ada akses untuk mengedit'
            });
        }

        // Update data feedback
        const updateData = {
            notes: notes.trim(),
            updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        };

        const { data: updatedFeedback, error: updateError } = await supabase
            .from('feedback_disposisi')
            .update(updateData)
            .eq('id', feedbackId)
            .select()
            .single();

        if (updateError) {
            console.error('Error updating feedback:', updateError);
            return res.status(400).json({ error: updateError.message });
        }

        console.log('Feedback berhasil diupdate:', updatedFeedback);

        // Handle penghapusan file lama jika ada
        let removedFileCount = 0;
        if (remove_file_ids) {
            try {
                const removeIds = Array.isArray(remove_file_ids) ? remove_file_ids : [remove_file_ids];

                // Ambil data file yang akan dihapus untuk mendapatkan storage_path
                const { data: filesToRemove, error: fetchError } = await supabase
                    .from('feedback_files')
                    .select('id, storage_path')
                    .eq('feedback_id', feedbackId)
                    .in('id', removeIds);

                if (!fetchError && filesToRemove && filesToRemove.length > 0) {
                    // Hapus dari storage
                    const storageFilesToDelete = filesToRemove
                        .filter(file => file.storage_path)
                        .map(file => file.storage_path);

                    if (storageFilesToDelete.length > 0) {
                        const { error: storageError } = await supabase.storage
                            .from('surat-photos')
                            .remove(storageFilesToDelete);

                        if (storageError) {
                            console.error('Error removing files from storage:', storageError);
                        }
                    }

                    // Hapus dari database
                    const { error: removeError } = await supabase
                        .from('feedback_files')
                        .delete()
                        .eq('feedback_id', feedbackId)
                        .in('id', removeIds);

                    if (removeError) {
                        console.error('Error removing files from database:', removeError);
                    } else {
                        removedFileCount = filesToRemove.length;
                        console.log(`${removedFileCount} files removed successfully`);
                    }
                }
            } catch (removeError) {
                console.error('Error in file removal process:', removeError);
            }
        }

        // Upload file baru jika ada - sama seperti di create feedback
        let newFileCount = 0;
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(file =>
                uploadToSupabaseStorage(file, 'feedback-disposisi', 'surat-photos')
            );

            try {
                const uploadResults = await Promise.all(uploadPromises);

                // Simpan data file baru ke database
                const fileData = uploadResults.map(result => ({
                    feedback_id: feedbackId,
                    disposisi_id: existingFeedback.disposisi_id,
                    file_path: result.publicUrl,
                    file_filename: result.fileName,
                    file_original_name: result.originalName,
                    file_size: result.size,
                    file_type: result.mimetype,
                    storage_path: result.fileName,
                    created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
                }));

                const { error: fileError } = await supabase
                    .from('feedback_files')
                    .insert(fileData);

                if (fileError) {
                    console.error('Error saving new files:', fileError);
                    // Rollback: hapus files dari storage
                    const filesToDelete = uploadResults.map(r => r.fileName);
                    await supabase.storage.from('surat-photos').remove(filesToDelete);

                    return res.status(400).json({ error: 'Gagal menyimpan file baru: ' + fileError.message });
                }

                newFileCount = req.files.length;
                console.log(`${newFileCount} new files uploaded successfully`);
            } catch (uploadError) {
                console.error('Upload error:', uploadError);
                return res.status(400).json({ error: 'Gagal upload file baru: ' + uploadError.message });
            }
        }

        // Update status disposisi - sama seperti di create feedback
        const { error: updateDisposisiError } = await supabase
            .from('disposisi')
            .update({
                status: status,
                [statusField]: status // Update status sesuai pilihan user
            })
            .eq('id', existingFeedback.disposisi_id);

        if (updateDisposisiError) {
            console.error('Error updating disposisi status:', updateDisposisiError);
            return res.status(500).json({ error: 'Gagal memperbarui status disposisi' });
        }

        console.log('Status disposisi diupdate menjadi:', status);

        // 🔧 TAMBAHAN: Insert ke disposisi_status_log
        const statusLogData = {
            disposisi_id: existingFeedback.disposisi_id,
            status: status, // status yang dikirimkan ('diproses' atau 'selesai')
            oleh_user_id: userId,
            keterangan: `Disposisi ${status} melalui update feedback oleh ${userJabatan}`
        };

        const { error: logError } = await supabase
            .from('disposisi_status_log')
            .insert([statusLogData]);

        if (logError) {
            console.error('Error creating status log:', logError);
            // Tidak throw error karena update feedback sudah berhasil
        }

        // Hitung total file setelah update
        const { data: remainingFiles, error: countError } = await supabase
            .from('feedback_files')
            .select('id')
            .eq('feedback_id', feedbackId);

        const totalFiles = remainingFiles ? remainingFiles.length : 0;

        res.json({
            message: `Feedback berhasil diperbarui dan status disposisi diupdate menjadi "${status}"`,
            data: {
                ...updatedFeedback,
                status_disposisi: status,
                file_count: totalFiles,
                has_files: totalFiles > 0,
                changes: {
                    removed_files: removedFileCount,
                    added_files: newFileCount
                }
            }
        });

    } catch (error) {
        console.error('Server error in feedback update:', error);
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    getKepalaFeedback,
    getKepalaDetailFeedback,
    getKepalaFileFeedback,
    getAtasanFileFeedback,
    deleteFileFeedback,
    getAtasanFeedback,
    buatAtasanFeedback,
    getAtasanFeedbackDariBawahan,
    getEditFeedbackAtasan,
    editFeedbackAtasan
}